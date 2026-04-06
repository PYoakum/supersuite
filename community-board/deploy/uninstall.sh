#!/bin/bash
#
# community-board uninstallation script for Linux (systemd)
#

set -e

INSTALL_DIR="/opt/community-board"
SERVICE_USER="community-board"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

if [[ $EUID -ne 0 ]]; then
    error "This script must be run as root (use sudo)"
fi

info "Uninstalling community-board..."

# Stop and remove systemd service
if [[ -f /etc/systemd/system/community-board.service ]]; then
    info "Stopping and removing systemd service..."
    systemctl stop community-board 2>/dev/null || true
    systemctl disable community-board 2>/dev/null || true
    rm -f /etc/systemd/system/community-board.service
    systemctl daemon-reload
    info "Systemd service removed"
else
    warn "Systemd service not found"
fi

# Remove installation directory
if [[ -d "$INSTALL_DIR" ]]; then
    read -p "Remove $INSTALL_DIR? This will delete all config and data files. [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$INSTALL_DIR"
        info "Removed $INSTALL_DIR"
    else
        info "Kept $INSTALL_DIR"
    fi
else
    warn "Install directory not found: $INSTALL_DIR"
fi

# Remove system user
if id "$SERVICE_USER" &>/dev/null; then
    read -p "Remove system user '$SERVICE_USER'? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        userdel "$SERVICE_USER"
        info "Removed system user '$SERVICE_USER'"
    else
        info "Kept system user '$SERVICE_USER'"
    fi
else
    warn "System user '$SERVICE_USER' not found"
fi

echo ""
info "Uninstall complete"
warn "PostgreSQL database and user were not removed. Clean up manually if needed:"
echo "  sudo -u postgres psql -c 'DROP DATABASE community_board;'"
echo "  sudo -u postgres psql -c 'DROP USER community_board;'"
