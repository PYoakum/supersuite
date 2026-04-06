#!/usr/bin/env bash
#
# deploy-remote.sh — Sync vm-provisioner to a remote host and run install.sh.
#
# Usage:
#   ./deploy/deploy-remote.sh user@host
#   ./deploy/deploy-remote.sh user@host --port 2222
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_DIR="/opt/vm-provisioner"
SSH_PORT=22

# ── Parse arguments ───────────────────────────────────────────────────────────
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 user@host [--port SSH_PORT]"
  exit 1
fi

TARGET="$1"
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) SSH_PORT="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 user@host [--port SSH_PORT]"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

SSH_OPTS="-p $SSH_PORT"
RSYNC_OPTS="-e 'ssh -p $SSH_PORT'"

echo "=== vm-provisioner remote deploy ==="
echo "  Source: $SCRIPT_DIR"
echo "  Target: $TARGET:$REMOTE_DIR"
echo ""

# ── 1. Sync project files ────────────────────────────────────────────────────
echo "Syncing files..."
eval rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'images/*.img' \
  --exclude 'images/*.qcow2' \
  -e "'ssh -p $SSH_PORT'" \
  "$SCRIPT_DIR/" "$TARGET:$REMOTE_DIR/"

echo "Files synced to $TARGET:$REMOTE_DIR"

# ── 2. Run install.sh on remote ──────────────────────────────────────────────
echo "Running install.sh on remote host..."
ssh $SSH_OPTS "$TARGET" "sudo $REMOTE_DIR/deploy/install.sh"

echo ""
echo "=== Deploy complete ==="
echo "  Start: ssh $SSH_OPTS $TARGET 'sudo systemctl start vmp-network vmp'"
echo "  Logs:  ssh $SSH_OPTS $TARGET 'journalctl -u vmp -f'"
