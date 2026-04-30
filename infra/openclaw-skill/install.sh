#!/usr/bin/env bash
# TRU-83 — wire the trust-swap-policy OpenClaw skill (TRU-82) so the
# openclaw user can read + write /srv/trust-swap/policy.json.
#
# What this does:
#   1) Adds the `openclaw` user to the `trust-swap-policy` group so it
#      can write to /srv/trust-swap/policy.json (mode 0664, group-
#      writable). The setgid 2775 bit on /srv/trust-swap/ (set by
#      infra/droplet/install.sh) makes atomic-rename writes inherit
#      the policy group automatically.
#   2) Symlinks trust-swap-policy.md into the openclaw skills directory
#      so the bot picks it up on next reload. Symlink (not copy) so
#      `git pull` on /opt/trust-swap/ updates the skill in place.
#
# Prereqs:
#   - infra/droplet/install.sh has run (creates trust-swap-policy group
#     + sets up /srv/trust-swap/)
#   - OpenClaw is installed and the openclaw user exists
#   - This repo is rsync'd to /opt/trust-swap/
#
# Re-running is safe: every step is idempotent. After running, openclaw
# must log out + back in (or restart the gateway service) for the new
# group membership to take effect.
#
# Usage:
#   sudo /opt/trust-swap/infra/openclaw-skill/install.sh
set -euo pipefail

# --- Constants ------------------------------------------------------------
POLICY_GROUP=trust-swap-policy
OPENCLAW_USER="${OPENCLAW_USER:-openclaw}"
OPENCLAW_HOME="$(getent passwd "$OPENCLAW_USER" 2>/dev/null | awk -F: '{print $6}')"
OPENCLAW_SKILLS_DIR="${OPENCLAW_SKILLS_DIR:-${OPENCLAW_HOME}/.openclaw/skills}"

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="$THIS_DIR/trust-swap-policy.md"

# --- Pre-flight ----------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  echo "install.sh must run as root (use sudo)" >&2
  exit 1
fi

if ! getent group "$POLICY_GROUP" >/dev/null; then
  echo "group $POLICY_GROUP missing — run infra/droplet/install.sh first" >&2
  exit 1
fi

if ! id "$OPENCLAW_USER" >/dev/null 2>&1; then
  echo "user $OPENCLAW_USER not on this host — install OpenClaw first, or" >&2
  echo "set OPENCLAW_USER=<name> if it runs under a different account" >&2
  exit 1
fi

if [[ ! -f "$SKILL_SRC" ]]; then
  echo "skill source missing: $SKILL_SRC" >&2
  exit 1
fi

if [[ -z "$OPENCLAW_HOME" ]]; then
  echo "could not resolve home directory for $OPENCLAW_USER" >&2
  exit 1
fi

# --- 1) Group membership -------------------------------------------------
# usermod -aG no-ops cleanly when the user is already a member, so this
# is safe to re-run.
usermod -a -G "$POLICY_GROUP" "$OPENCLAW_USER"
echo "  + $OPENCLAW_USER joined group $POLICY_GROUP"

# --- 2) Symlink skill ----------------------------------------------------
install -d -m 0755 -o "$OPENCLAW_USER" -g "$OPENCLAW_USER" "$OPENCLAW_SKILLS_DIR"
ln -sfn "$SKILL_SRC" "$OPENCLAW_SKILLS_DIR/trust-swap-policy.md"
echo "  + linked $SKILL_SRC → $OPENCLAW_SKILLS_DIR/trust-swap-policy.md"

# --- Verification --------------------------------------------------------
cat <<EOF

  trust-swap-policy skill installed for $OPENCLAW_USER.

  IMPORTANT — group membership only takes effect on a fresh process.
  Restart the OpenClaw gateway (or log out / log in if running as a
  user session) before testing the skill:

    sudo systemctl restart openclaw-gateway   # if installed via systemd
    # OR
    openclaw node restart                     # if installed via openclaw CLI

  End-to-end smoke (after restart):

    sudo -u $OPENCLAW_USER bash -c '
      cp /srv/trust-swap/policy.json /tmp/policy.json
      cp /tmp/policy.json /srv/trust-swap/policy.json.tmp
      mv /srv/trust-swap/policy.json.tmp /srv/trust-swap/policy.json
    '
    # Should succeed silently. If "Permission denied", the openclaw
    # process still has its pre-restart group cache — bounce it.

  Then text the bot ("what's in my trust-swap policy?") and confirm
  it reads + parses the file without errors.

EOF
