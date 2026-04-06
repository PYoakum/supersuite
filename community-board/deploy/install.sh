#!/bin/bash
#
# community-board installation script for Linux (systemd)
#
# Usage:
#   sudo ./install.sh
#
# This script:
#   1. Installs bun if not present
#   2. Creates a dedicated system user
#   3. Copies community-board to /opt/community-board
#   4. Installs npm dependencies
#   5. Sets permissions and installs the systemd service
#

set -e

INSTALL_DIR="/opt/community-board"
SERVICE_USER="community-board"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    error "This script must be run as root (use sudo)"
fi

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

info "Installing community-board..."
info "  Install directory: $INSTALL_DIR"

# Step 1: Install bun if not present
if command -v bun &> /dev/null; then
    info "Bun is already installed: $(which bun)"
else
    info "Installing bun..."
    curl -fsSL https://bun.sh/install | bash

    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"

    if ! command -v bun &> /dev/null; then
        for p in /root/.bun/bin/bun /home/*/.bun/bin/bun; do
            if [[ -x "$p" ]]; then
                export PATH="$(dirname "$p"):$PATH"
                break
            fi
        done
    fi

    if ! command -v bun &> /dev/null; then
        error "Bun installation failed. Please install manually: https://bun.sh"
    fi

    info "Bun installed: $(which bun)"
fi

# Step 2: Create system user if missing
if id "$SERVICE_USER" &>/dev/null; then
    info "System user '$SERVICE_USER' already exists"
else
    info "Creating system user '$SERVICE_USER'..."
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
    info "System user created"
fi

# Step 3: Copy files to install directory
info "Copying files to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"

rsync -a --delete \
    --exclude 'deploy/' \
    --exclude '.git/' \
    --exclude '.claude/' \
    --exclude '.DS_Store' \
    --exclude 'config.toml' \
    --exclude 'node_modules/' \
    "$SCRIPT_DIR/../" "$INSTALL_DIR/"

info "Files copied successfully"

# Step 4: Set up config file
if [[ -f "$INSTALL_DIR/config.toml" ]]; then
    info "Config file already exists, keeping current config"
else
    if [[ -f "$INSTALL_DIR/config.toml.example" ]]; then
        cp "$INSTALL_DIR/config.toml.example" "$INSTALL_DIR/config.toml"
        warn "Created config.toml from example — edit $INSTALL_DIR/config.toml with your database credentials before starting"
    else
        warn "No config.toml.example found. Create $INSTALL_DIR/config.toml manually."
    fi
fi

# Step 5: Install npm dependencies
info "Installing dependencies..."
cd "$INSTALL_DIR"
bun install --production

# Step 6: Set ownership and permissions
info "Setting file ownership and permissions..."
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod 600 "$INSTALL_DIR/config.toml"

# Step 7: Install systemd service
info "Installing systemd service..."
bun server.js install

echo ""
info "Installation complete!"
echo ""
echo "Commands:"
echo "  sudo systemctl status community-board      # Check service status"
echo "  sudo systemctl restart community-board      # Restart service"
echo "  sudo journalctl -u community-board -f       # View logs"
echo ""
warn "Make sure PostgreSQL is running and the database/user are configured."
warn "Edit $INSTALL_DIR/config.toml if you haven't already, then restart:"
echo "  sudo systemctl restart community-board"
