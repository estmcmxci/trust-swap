#!/usr/bin/env bash
# Redeploy daemon-2 (daemon.trustrust.eth) to the droplet after re-provisioning.
#
# Prerequisite: `pnpm provision:daemon --ens-name daemon.trustrust.eth` ran
# locally and produced a fresh kernel + session key. This script:
#
#   1. Reads the new kernel address from infra/identities/daemon-trustrust.json
#   2. rsyncs the new session-key file to the droplet's
#      /var/lib/trust-swap/.synthesis/ (mode 600, owned by trust-swap)
#   3. Updates /srv/trust-swap/policy-trustrust.json on the droplet with
#      the new kernel address (everything else preserved — intents, listen,
#      constraints, intervalSec)
#   4. systemctl reset-failed + restart trust-swap-agent-trustrust
#   5. Tails the journal for ~10s to confirm the daemon comes up
#
# By default this prints the plan and asks for confirmation. Pass --yes to
# skip the prompt.
#
# Usage:
#   scripts/redeploy-daemon-trustrust.sh [--ssh <target>] [--yes] [--dry-run]
#
# Defaults:
#   --ssh root@estmcmxci

set -euo pipefail

SSH_TARGET="root@estmcmxci"
ASSUME_YES=0
DRY_RUN=0
INSTANCE="trustrust"
IDENTITY_FILE="infra/identities/daemon-trustrust.json"
LOCAL_SESSION_KEY="$HOME/.synthesis/daemon-trustrust-session-key.json"
REMOTE_SESSION_KEY="/var/lib/trust-swap/.synthesis/daemon-trustrust-session-key.json"
REMOTE_POLICY="/srv/trust-swap/policy-trustrust.json"
SERVICE="trust-swap-agent-trustrust"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh) SSH_TARGET="$2"; shift 2 ;;
    --ssh=*) SSH_TARGET="${1#--ssh=}"; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --dry-run|-n) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | sed -n '/^# /s/^# \{0,1\}//p'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

# --- Sanity: tools we depend on ------------------------------------------
for tool in jq rsync ssh; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }
done

# --- Sanity: identity file + session key exist locally -------------------
if [[ ! -f "$IDENTITY_FILE" ]]; then
  echo "missing $IDENTITY_FILE — run pnpm provision:daemon --ens-name daemon.trustrust.eth first" >&2
  exit 1
fi
if [[ ! -f "$LOCAL_SESSION_KEY" ]]; then
  echo "missing $LOCAL_SESSION_KEY — provision-daemon should have written it" >&2
  exit 1
fi

NEW_KERNEL=$(jq -r '.daemonKernelAddress' "$IDENTITY_FILE")
NEW_OWNER=$(jq -r '.daemonOwnerAddress' "$IDENTITY_FILE")
SESSION_VALID_UNTIL=$(jq -r '.sessionKeyValidUntilISO' "$IDENTITY_FILE")

if [[ -z "$NEW_KERNEL" || "$NEW_KERNEL" == "null" ]]; then
  echo "could not read .daemonKernelAddress from $IDENTITY_FILE" >&2
  exit 1
fi

# --- Print plan -----------------------------------------------------------
cat <<EOF

Redeploying daemon-2 (daemon.trustrust.eth) to $SSH_TARGET

  identity file:    $IDENTITY_FILE
  new kernel:       $NEW_KERNEL
  new owner:        $NEW_OWNER
  session valid:    $SESSION_VALID_UNTIL

Steps:
  1. rsync $LOCAL_SESSION_KEY → $SSH_TARGET:$REMOTE_SESSION_KEY
  2. update $REMOTE_POLICY: agent.kernelAddress = $NEW_KERNEL
  3. systemctl reset-failed + restart $SERVICE
  4. tail journal for ~10s

EOF

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] no remote changes will be made"
  exit 0
fi

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "Proceed? [y/N] " ans
  case "$ans" in y|Y|yes|YES) ;; *) echo "aborted"; exit 1 ;; esac
fi

# --- Preflight: ensure jq is on the droplet ------------------------------
# Step 2's policy update needs jq remotely. The droplet ships without it —
# `redeploy-daemon-trustrust.sh` initially failed mid-run when /usr/bin/jq
# was missing. apt-get install is fast (<5s on a fresh box) and idempotent,
# so we just run it unconditionally rather than branch on `command -v`.
echo
echo "[0/4] preflight: ensure jq on droplet"
ssh "$SSH_TARGET" "
  set -euo pipefail
  if ! command -v jq >/dev/null; then
    echo '  installing jq via apt-get…'
    DEBIAN_FRONTEND=noninteractive apt-get -qq update >/dev/null
    DEBIAN_FRONTEND=noninteractive apt-get -qq install -y jq >/dev/null
  fi
  jq --version | sed 's/^/  /'
"

# --- Step 1: rsync session key -------------------------------------------
echo
echo "[1/4] rsync session key"
# Stage to a temp path on the droplet, then move + chown atomically (the
# trust-swap user can't write to .synthesis/ directly via rsync as root).
ssh "$SSH_TARGET" "install -d -m 0700 -o trust-swap -g trust-swap /var/lib/trust-swap/.synthesis"
rsync -av --chmod=0600 "$LOCAL_SESSION_KEY" "$SSH_TARGET:/tmp/daemon-trustrust-session-key.new"
ssh "$SSH_TARGET" "
  install -m 0600 -o trust-swap -g trust-swap /tmp/daemon-trustrust-session-key.new $REMOTE_SESSION_KEY
  rm -f /tmp/daemon-trustrust-session-key.new
"

# --- Step 2: update policy kernelAddress ---------------------------------
echo
echo "[2/4] update kernelAddress in $REMOTE_POLICY"
# Atomic-rename via temp file (matches OpenClaw write-then-rename, TRU-82).
# Reads the existing policy on the droplet so any local edits (intent
# enablement, intervalSec backup-revert, etc.) are preserved.
ssh "$SSH_TARGET" "
  set -euo pipefail
  if [[ ! -f $REMOTE_POLICY ]]; then
    echo 'remote policy not found: $REMOTE_POLICY' >&2
    exit 1
  fi
  cp $REMOTE_POLICY $REMOTE_POLICY.bak.\$(date +%s)
  jq '.agent.kernelAddress = \"$NEW_KERNEL\"' $REMOTE_POLICY > /tmp/policy-trustrust.new
  install -m 0664 -o trust-swap -g trust-swap-policy /tmp/policy-trustrust.new $REMOTE_POLICY
  rm -f /tmp/policy-trustrust.new
  echo '  new kernelAddress:'
  jq -r '.agent.kernelAddress' $REMOTE_POLICY | sed 's/^/    /'
"

# --- Step 3: systemctl reset-failed + restart ----------------------------
echo
echo "[3/4] reset-failed + restart $SERVICE"
ssh "$SSH_TARGET" "systemctl reset-failed $SERVICE && systemctl restart $SERVICE"

# --- Step 4: tail journal --------------------------------------------------
echo
echo "[4/4] journal (10s)"
ssh "$SSH_TARGET" "timeout 10 journalctl -u $SERVICE -f --no-pager -o cat" || true

echo
echo "Redeploy complete. Verify with:"
echo "  ssh $SSH_TARGET 'systemctl is-active $SERVICE'"
echo "  ssh $SSH_TARGET 'journalctl -u $SERVICE -n 50 --no-pager' | jq 'select(.type | startswith(\"peer.\"))'"
