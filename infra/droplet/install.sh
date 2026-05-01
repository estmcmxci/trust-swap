#!/usr/bin/env bash
# TrustSwap autonomous daemon — idempotent installer (TRU-37 / TRU-42).
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
# Multi-instance: pass `--instance <slug>` to install a parallel daemon
# alongside the primary one. The slug suffixes every per-daemon file:
#
#   --instance ""           (default)        --instance trustrust
#     trust-swap-agent.service                trust-swap-agent-trustrust.service
#     /etc/trust-swap/agent.env               /etc/trust-swap/agent-trustrust.env
#     /srv/trust-swap/policy.json             /srv/trust-swap/policy-trustrust.json
#
# Run install.sh once per instance. Shared resources (system user, group,
# /var/lib/trust-swap, the trust-swap-policy ACLs) are created on the
# first run and reused.
#
# Usage (from the rsync'd `/opt/trust-swap/`):
#   sudo /opt/trust-swap/infra/droplet/install.sh
#   sudo /opt/trust-swap/infra/droplet/install.sh --instance trustrust
set -euo pipefail

# --- Args -----------------------------------------------------------------
INSTANCE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --instance)
      INSTANCE="${2:-}"
      shift 2
      ;;
    --instance=*)
      INSTANCE="${1#--instance=}"
      shift
      ;;
    *)
      echo "install.sh: unknown arg $1" >&2
      echo "Usage: install.sh [--instance <slug>]" >&2
      exit 1
      ;;
  esac
done

if [[ -n "$INSTANCE" && ! "$INSTANCE" =~ ^[a-z0-9-]+$ ]]; then
  echo "install.sh: --instance must match [a-z0-9-]+ (got '$INSTANCE')" >&2
  exit 1
fi

# --- Constants ------------------------------------------------------------
if [[ -n "$INSTANCE" ]]; then
  SUFFIX="-$INSTANCE"
else
  SUFFIX=""
fi
SERVICE_NAME="trust-swap-agent$SUFFIX"
ENV_FILE="agent$SUFFIX.env"
POLICY_FILE="policy$SUFFIX.json"
SAMPLE_ENV="agent$SUFFIX.env.example"
SAMPLE_POLICY="sample-operating-policy$SUFFIX.json"
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

# --- Validate sample files exist for this instance ------------------------
for sample in "$SAMPLE_ENV" "$SAMPLE_POLICY"; do
  if [[ ! -f "$THIS_DIR/$sample" ]]; then
    echo "install.sh: missing sample file $THIS_DIR/$sample" >&2
    echo "  add it under infra/droplet/ before installing instance '$INSTANCE'" >&2
    exit 1
  fi
done

if [[ ! -f "$THIS_DIR/systemd/$SERVICE_NAME.service" ]]; then
  echo "install.sh: missing $THIS_DIR/systemd/$SERVICE_NAME.service" >&2
  echo "  add it under infra/droplet/systemd/ before installing instance '$INSTANCE'" >&2
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

# --- /etc/trust-swap/<env> ------------------------------------------------
install -d -m 0750 -o "$RUN_USER" -g "$RUN_GROUP" "$ETC_DIR"
if [[ ! -f "$ETC_DIR/$ENV_FILE" ]]; then
  install -m 0600 -o "$RUN_USER" -g "$RUN_GROUP" \
          "$THIS_DIR/$SAMPLE_ENV" "$ETC_DIR/$ENV_FILE"
  echo "  + wrote $ETC_DIR/$ENV_FILE (template — fill in real values before starting)"
else
  echo "  · $ETC_DIR/$ENV_FILE exists — leaving in place"
fi

# --- /srv/trust-swap/<policy> ---------------------------------------------
# setgid bit (2775) so atomic-rename writes (OpenClaw, TRU-82) inherit
# the trust-swap-policy group automatically.
install -d -m 2775 -o "$RUN_USER" -g "$POLICY_GROUP" "$SRV_DIR"
if [[ ! -f "$SRV_DIR/$POLICY_FILE" ]]; then
  install -m 0664 -o "$RUN_USER" -g "$POLICY_GROUP" \
          "$THIS_DIR/$SAMPLE_POLICY" "$SRV_DIR/$POLICY_FILE"
  echo "  + wrote $SRV_DIR/$POLICY_FILE (sample fixture — review before starting)"
else
  echo "  · $SRV_DIR/$POLICY_FILE exists — leaving in place"
fi

# --- systemd unit ---------------------------------------------------------
install -m 0644 -o root -g root \
        "$THIS_DIR/systemd/$SERVICE_NAME.service" \
        "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
echo "  + dropped /etc/systemd/system/$SERVICE_NAME.service + daemon-reload"

# --- Next steps -----------------------------------------------------------
if [[ -n "$INSTANCE" ]]; then
  SESSION_KEY_HINT="daemon-$INSTANCE-session-key.json"
else
  SESSION_KEY_HINT="daemon-session-key.json"
fi
cat <<EOF

  TrustSwap daemon installed (instance: ${INSTANCE:-default}).

  Before enabling the service:
    1) Edit $ETC_DIR/$ENV_FILE — set BUNDLER_URL_BASE, ORACLE_URL,
       UNISWAP_API_KEY, and TRU_AGENT_STATUS_BIND (Tailscale IP).
    2) Place the daemon session-key file at:
         $HOME_DIR/.synthesis/$SESSION_KEY_HINT
       (chmod 600, owned by $RUN_USER — rsync from the local machine
       where pnpm provision:daemon ran).
    3) Review $SRV_DIR/$POLICY_FILE — currently the sample fixture.

  Then:
    sudo systemctl enable --now $SERVICE_NAME
    journalctl -u $SERVICE_NAME -f

EOF
