#!/usr/bin/env bash
#
# teardown-network.sh — Tear down bridge, TAP pool, iptables, dnsmasq for vm-provisioner.
# Run as root after stopping the server.
#
set -euo pipefail

CONFIG_PATH="/tmp/vmp-network.json"
PID_FILE="/tmp/vmp-dnsmasq.pid"

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-path) CONFIG_PATH="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: sudo $0 [options]"
      echo "  --config-path PATH  Config file path (default: /tmp/vmp-network.json)"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Require root ──────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "Error: this script must be run as root (sudo $0)"
  exit 1
fi

# ── Read config ───────────────────────────────────────────────────────────────
if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Error: config file not found at $CONFIG_PATH"
  echo "  Was setup-network.sh run?"
  exit 1
fi

BRIDGE_NAME=$(cat "$CONFIG_PATH" | grep -o '"bridgeName"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"//;s/"//')
SUBNET=$(cat "$CONFIG_PATH" | grep -o '"subnet"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"//;s/"//')
LEASE_FILE=$(cat "$CONFIG_PATH" | grep -o '"leaseFile"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"//;s/"//')
TAP_NAMES=$(cat "$CONFIG_PATH" | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"//;s/"//')

echo "=== vm-provisioner network teardown ==="

# ── 1. Stop dnsmasq ──────────────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "Stopped dnsmasq (PID $PID)"
  fi
  rm -f "$PID_FILE"
fi
rm -f "$LEASE_FILE"

# ── 2. Delete TAP devices ────────────────────────────────────────────────────
TAP_COUNT=0
for TAP in $TAP_NAMES; do
  if ip link show "$TAP" &>/dev/null; then
    ip link set "$TAP" down
    ip tuntap del dev "$TAP" mode tap
    TAP_COUNT=$((TAP_COUNT + 1))
  fi
done
echo "Deleted $TAP_COUNT TAP devices"

# ── 3. Remove iptables rules ────────────────────────────────────────────────
OUT_IFACE=$(ip route show default | awk '/default/{print $5; exit}')
if [[ -n "$OUT_IFACE" && -n "$SUBNET" ]]; then
  iptables -t nat -D POSTROUTING -s "$SUBNET" -o "$OUT_IFACE" -j MASQUERADE 2>/dev/null || true
  iptables -D FORWARD -i "$OUT_IFACE" -o "$BRIDGE_NAME" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
  iptables -D FORWARD -i "$BRIDGE_NAME" -o "$OUT_IFACE" -j ACCEPT 2>/dev/null || true
  echo "iptables rules removed"
fi

# ── 4. Destroy bridge ────────────────────────────────────────────────────────
if ip link show "$BRIDGE_NAME" &>/dev/null; then
  ip link set "$BRIDGE_NAME" down
  ip link delete "$BRIDGE_NAME"
  echo "Bridge $BRIDGE_NAME destroyed"
fi

# ── 5. Remove config file ────────────────────────────────────────────────────
rm -f "$CONFIG_PATH"

echo ""
echo "=== Teardown complete ==="
