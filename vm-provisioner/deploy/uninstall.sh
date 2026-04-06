#!/usr/bin/env bash
#
# uninstall.sh — Remove vm-provisioner systemd units and optionally purge all files.
# Run as root.
#
#   sudo ./uninstall.sh          # remove services only
#   sudo ./uninstall.sh --purge  # also remove /opt/vm-provisioner and vmp user
#
set -euo pipefail

INSTALL_DIR="/opt/vm-provisioner"
SERVICE_USER="vmp"
PURGE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge) PURGE=true; shift ;;
    -h|--help)
      echo "Usage: sudo $0 [--purge]"
      echo "  --purge  Also remove $INSTALL_DIR and $SERVICE_USER user/group"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Require root ──────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "Error: this script must be run as root (sudo $0)"
  exit 1
fi

echo "=== vm-provisioner uninstall ==="

# ── 1. Stop and disable services ─────────────────────────────────────────────
for unit in vmp vmp-network; do
  if systemctl is-active --quiet "$unit" 2>/dev/null; then
    systemctl stop "$unit"
    echo "Stopped $unit"
  fi
  if systemctl is-enabled --quiet "$unit" 2>/dev/null; then
    systemctl disable "$unit"
    echo "Disabled $unit"
  fi
done

# ── 2. Remove unit files ─────────────────────────────────────────────────────
rm -f /etc/systemd/system/vmp.service
rm -f /etc/systemd/system/vmp-network.service
systemctl daemon-reload
echo "Removed systemd units"

# ── 3. Purge (optional) ──────────────────────────────────────────────────────
if [[ "$PURGE" == "true" ]]; then
  if [[ -d "$INSTALL_DIR" ]]; then
    rm -rf "$INSTALL_DIR"
    echo "Removed $INSTALL_DIR"
  fi

  if id "$SERVICE_USER" &>/dev/null; then
    userdel "$SERVICE_USER"
    echo "Removed user '$SERVICE_USER'"
  fi

  if getent group "$SERVICE_USER" &>/dev/null; then
    groupdel "$SERVICE_USER"
    echo "Removed group '$SERVICE_USER'"
  fi

  echo "Purge complete"
else
  echo ""
  echo "Services removed. Files remain at $INSTALL_DIR"
  echo "  To fully remove: sudo $0 --purge"
fi

echo ""
echo "=== Uninstall complete ==="
