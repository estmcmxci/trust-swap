#!/usr/bin/env bash
# TrustSwap autonomous daemon — idempotent installer (TRU-37).
#
# Creates the `trust-swap` system user + `trust-swap-policy` group, drops
# the systemd unit, lays down `/etc/trust-swap/agent.env` (mode 600) and
# `/srv/trust-swap/policy.json` (mode 0664) from samples if they don't
# already exist, then `daemon-reload`. Does NOT auto-enable — the
# operator fills in real values + the daemon's session-key file before
# `systemctl enable --now trust-swap-agent`.
#
# Re-running this script is safe: existing `agent.env` and `policy.json`
# are left in place, the user/group creation skips if present, and the
# unit file is overwritten with the latest from the repo.
#
# Usage (from the rsync'd `/opt/trust-swap/`):
#   sudo /opt/trust-swap/infra/droplet/install.sh
set -euo pipefail

# --- Constants ------------------------------------------------------------
SERVICE_NAME=trust-swap-agent
RUN_USER=trust-swap
RUN_GROUP=trust-swap
POLICY_GROUP=trust-swap-policy
HOME_DIR=/var/lib/trust-swap
ETC_DIR=/etc/trust-swap
SRV_DIR=/srv/trust-swap

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Require root ---------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  echo "install.sh must run as root (use sudo)" >&2
  exit 1
fi

# --- Group + user ---------------------------------------------------------
if ! getent group "$POLICY_GROUP" >/dev/null; then
  groupadd --system "$POLICY_GROUP"
  echo "  + created group $POLICY_GROUP"
fi

if ! id "$RUN_USER" >/dev/null 2>&1; then
  useradd --system \
          --home "$HOME_DIR" \
          --create-home \
          --shell /usr/sbin/nologin \
          --user-group "$RUN_USER"
  echo "  + created user $RUN_USER (home: $HOME_DIR, shell: nologin)"
fi

usermod -a -G "$POLICY_GROUP" "$RUN_USER"
chown "$RUN_USER:$RUN_GROUP" "$HOME_DIR"
chmod 0750 "$HOME_DIR"
install -d -m 0700 -o "$RUN_USER" -g "$RUN_GROUP" "$HOME_DIR/.synthesis"

# --- /etc/trust-swap/agent.env --------------------------------------------
install -d -m 0750 -o "$RUN_USER" -g "$RUN_GROUP" "$ETC_DIR"
if [[ ! -f "$ETC_DIR/agent.env" ]]; then
  install -m 0600 -o "$RUN_USER" -g "$RUN_GROUP" \
          "$THIS_DIR/agent.env.example" "$ETC_DIR/agent.env"
  echo "  + wrote $ETC_DIR/agent.env (template — fill in real values before starting)"
else
  echo "  · $ETC_DIR/agent.env exists — leaving in place"
fi

# --- /srv/trust-swap/policy.json ------------------------------------------
# setgid bit (2775) so atomic-rename writes (OpenClaw, TRU-82) inherit
# the trust-swap-policy group automatically.
install -d -m 2775 -o "$RUN_USER" -g "$POLICY_GROUP" "$SRV_DIR"
if [[ ! -f "$SRV_DIR/policy.json" ]]; then
  install -m 0664 -o "$RUN_USER" -g "$POLICY_GROUP" \
          "$THIS_DIR/sample-operating-policy.json" "$SRV_DIR/policy.json"
  echo "  + wrote $SRV_DIR/policy.json (sample fixture — review before starting)"
else
  echo "  · $SRV_DIR/policy.json exists — leaving in place"
fi

# --- systemd unit ---------------------------------------------------------
install -m 0644 -o root -g root \
        "$THIS_DIR/systemd/$SERVICE_NAME.service" \
        "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
echo "  + dropped /etc/systemd/system/$SERVICE_NAME.service + daemon-reload"

# --- Next steps -----------------------------------------------------------
cat <<EOF

  TrustSwap daemon installed.

  Before enabling the service:
    1) Edit $ETC_DIR/agent.env — set BUNDLER_URL_BASE, ORACLE_URL,
       UNISWAP_API_KEY, and TRU_AGENT_STATUS_BIND (Tailscale IP).
    2) Place the daemon session-key file at:
         $HOME_DIR/.synthesis/daemon-session-key.json
       (chmod 600, owned by $RUN_USER — rsync from the local machine
       where pnpm provision:daemon ran).
    3) Review $SRV_DIR/policy.json — currently the sample fixture.

  Then:
    sudo systemctl enable --now $SERVICE_NAME
    journalctl -u $SERVICE_NAME -f

EOF
