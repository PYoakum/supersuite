#!/usr/bin/env bash
#
# install.sh — Deploy vm-provisioner to /opt/vm-provisioner with systemd units.
# Run as root.
#
set -euo pipefail

INSTALL_DIR="/opt/vm-provisioner"
SERVICE_USER="vmp"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── Require root ──────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "Error: this script must be run as root (sudo $0)"
  exit 1
fi

echo "=== vm-provisioner install ==="
echo "  Source: $SCRIPT_DIR"
echo "  Target: $INSTALL_DIR"

# ── 1. Create system user ────────────────────────────────────────────────────
if id "$SERVICE_USER" &>/dev/null; then
  echo "User '$SERVICE_USER' already exists"
else
  useradd --system --shell /usr/sbin/nologin --home-dir "$INSTALL_DIR" --create-home "$SERVICE_USER"
  echo "Created system user '$SERVICE_USER'"
fi

# ── 2. Copy project files ────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'images/*.img' \
  --exclude 'images/*.qcow2' \
  "$SCRIPT_DIR/" "$INSTALL_DIR/"

echo "Synced project files to $INSTALL_DIR"

# ── 3. Create images directory ────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR/images"
chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/images"
echo "Images directory: $INSTALL_DIR/images"

# ── 4. Install bun dependencies ──────────────────────────────────────────────
if command -v bun &>/dev/null; then
  echo "bun found: $(bun --version)"
else
  echo "WARNING: bun not found in PATH"
  echo "  Install bun before starting the service:"
  echo "  curl -fsSL https://bun.sh/install | bash"
fi

# ── 5. Install systemd units ─────────────────────────────────────────────────
cp "$INSTALL_DIR/deploy/vmp-network.service" /etc/systemd/system/vmp-network.service
cp "$INSTALL_DIR/deploy/vmp.service" /etc/systemd/system/vmp.service
echo "Installed systemd units"

systemctl daemon-reload
systemctl enable vmp-network vmp
echo "Enabled vmp-network and vmp services"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "=== Install complete ==="
echo ""
echo "  Edit config before starting:"
echo "    sudo nano $INSTALL_DIR/deploy/vmp.env"
echo ""
echo "  Start services:"
echo "    sudo systemctl start vmp-network"
echo "    sudo systemctl start vmp"
echo ""
echo "  View logs:"
echo "    journalctl -u vmp -f"
echo "    journalctl -u vmp-network -f"
echo ""
echo "  Uninstall:"
echo "    sudo $INSTALL_DIR/deploy/uninstall.sh"
echo ""
