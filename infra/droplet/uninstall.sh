#!/usr/bin/env bash
# Reverse-pair of install.sh. Stops + disables the service, removes the
# systemd unit. The system user, group, $HOME_DIR, $ETC_DIR, and $SRV_DIR
# are left in place because they may contain encrypted keys, the live
# policy file, and JSONL audit logs — destructive removal is the
# operator's call.
set -euo pipefail

SERVICE_NAME=trust-swap-agent
RUN_USER=trust-swap
POLICY_GROUP=trust-swap-policy
HOME_DIR=/var/lib/trust-swap
ETC_DIR=/etc/trust-swap
SRV_DIR=/srv/trust-swap
APP_DIR=/opt/trust-swap

if [[ $EUID -ne 0 ]]; then
  echo "uninstall.sh must run as root (use sudo)" >&2
  exit 1
fi

if systemctl list-unit-files "$SERVICE_NAME.service" >/dev/null 2>&1; then
  systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
  echo "  · disabled + stopped $SERVICE_NAME"
fi
rm -f "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
echo "  · removed systemd unit + reloaded"

cat <<EOF

  Service removed. The following are left in place — review before
  removing manually:

    user/group:    $RUN_USER, $POLICY_GROUP
    home:          $HOME_DIR  (may contain encrypted session keys)
    runtime cfg:   $ETC_DIR   (mode 0750, holds agent.env)
    policy:        $SRV_DIR   (live operating policy)
    binary:        $APP_DIR   (rsync'd CLI artifact)

  Hard wipe (destroys the daemon's keys + audit history):

    sudo userdel -r $RUN_USER
    sudo groupdel $POLICY_GROUP
    sudo rm -rf $ETC_DIR $SRV_DIR $APP_DIR

EOF
