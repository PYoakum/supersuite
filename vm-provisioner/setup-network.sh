#!/usr/bin/env bash
#
# setup-network.sh — Create bridge, TAP pool, iptables, dnsmasq for vm-provisioner.
# Run once as root before starting the server as an unprivileged user.
#
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
TAP_COUNT=8
BRIDGE_NAME="vmp-br0"
SUBNET="172.20.0.0/24"
BRIDGE_IP="172.20.0.1"
DHCP_RANGE_START="172.20.0.2"
DHCP_RANGE_END="172.20.0.254"
CONFIG_PATH="/tmp/vmp-network.json"

PID_FILE="/tmp/vmp-dnsmasq.pid"
LEASE_FILE="/tmp/vmp-dnsmasq.leases"

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tap-count)       TAP_COUNT="$2";       shift 2 ;;
    --bridge-name)     BRIDGE_NAME="$2";     shift 2 ;;
    --subnet)          SUBNET="$2";          shift 2 ;;
    --bridge-ip)       BRIDGE_IP="$2";       shift 2 ;;
    --dhcp-range-start) DHCP_RANGE_START="$2"; shift 2 ;;
    --dhcp-range-end)  DHCP_RANGE_END="$2";  shift 2 ;;
    --config-path)     CONFIG_PATH="$2";     shift 2 ;;
    -h|--help)
      echo "Usage: sudo $0 [options]"
      echo "  --tap-count N          Number of TAP devices (default: 8)"
      echo "  --bridge-name NAME     Bridge interface name (default: vmp-br0)"
      echo "  --subnet CIDR          Subnet (default: 172.20.0.0/24)"
      echo "  --bridge-ip IP         Bridge IP (default: 172.20.0.1)"
      echo "  --dhcp-range-start IP  DHCP range start (default: 172.20.0.2)"
      echo "  --dhcp-range-end IP    DHCP range end (default: 172.20.0.254)"
      echo "  --config-path PATH     Config output path (default: /tmp/vmp-network.json)"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

MASK="${SUBNET##*/}"
BRIDGE_CIDR="${BRIDGE_IP}/${MASK}"

# ── Require root ──────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "Error: this script must be run as root (sudo $0)"
  exit 1
fi

echo "=== vm-provisioner network setup ==="

# ── 1. Create bridge (idempotent) ────────────────────────────────────────────
if ip link show "$BRIDGE_NAME" &>/dev/null; then
  echo "Bridge $BRIDGE_NAME already exists, reusing"
else
  ip link add "$BRIDGE_NAME" type bridge
  ip addr add "$BRIDGE_CIDR" dev "$BRIDGE_NAME"
  ip link set "$BRIDGE_NAME" up
  echo "Created bridge $BRIDGE_NAME ($BRIDGE_CIDR)"
fi

# ── 2. Enable IP forwarding ──────────────────────────────────────────────────
sysctl -w net.ipv4.ip_forward=1 >/dev/null
echo "IP forwarding enabled"

# ── 3. Detect outbound interface ─────────────────────────────────────────────
OUT_IFACE=$(ip route show default | awk '/default/{print $5; exit}')
if [[ -z "$OUT_IFACE" ]]; then
  echo "Error: no default route found"
  exit 1
fi
echo "Outbound interface: $OUT_IFACE"

# ── 4. iptables rules (idempotent via -C check) ─────────────────────────────
if ! iptables -t nat -C POSTROUTING -s "$SUBNET" -o "$OUT_IFACE" -j MASQUERADE 2>/dev/null; then
  iptables -t nat -A POSTROUTING -s "$SUBNET" -o "$OUT_IFACE" -j MASQUERADE
  echo "Added MASQUERADE rule: $SUBNET -> $OUT_IFACE"
else
  echo "MASQUERADE rule already exists"
fi

if ! iptables -C FORWARD -i "$OUT_IFACE" -o "$BRIDGE_NAME" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null; then
  iptables -A FORWARD -i "$OUT_IFACE" -o "$BRIDGE_NAME" -m state --state RELATED,ESTABLISHED -j ACCEPT
fi

if ! iptables -C FORWARD -i "$BRIDGE_NAME" -o "$OUT_IFACE" -j ACCEPT 2>/dev/null; then
  iptables -A FORWARD -i "$BRIDGE_NAME" -o "$OUT_IFACE" -j ACCEPT
fi
echo "FORWARD rules: $BRIDGE_NAME <-> $OUT_IFACE"

# ── 5. Create TAP devices ───────────────────────────────────────────────────
TAPS_JSON="["
for i in $(seq 0 $((TAP_COUNT - 1))); do
  TAP_NAME="vmp-tap${i}"
  # MAC: 52:54:00:00:00:XX (hex index, 1-based)
  HEX=$(printf "%02x" $((i + 1)))
  MAC="52:54:00:00:00:${HEX}"

  if ip link show "$TAP_NAME" &>/dev/null; then
    echo "TAP $TAP_NAME already exists, reusing"
  else
    ip tuntap add dev "$TAP_NAME" mode tap
    ip link set "$TAP_NAME" master "$BRIDGE_NAME"
    ip link set "$TAP_NAME" up
  fi

  # Build JSON array entry
  [[ $i -gt 0 ]] && TAPS_JSON+=","
  TAPS_JSON+="{\"name\":\"${TAP_NAME}\",\"mac\":\"${MAC}\"}"
done
TAPS_JSON+="]"
echo "Created $TAP_COUNT TAP devices (vmp-tap0..vmp-tap$((TAP_COUNT - 1)))"

# ── 6. Start dnsmasq (if not already running) ───────────────────────────────
DNSMASQ_RUNNING=false
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    DNSMASQ_RUNNING=true
    echo "dnsmasq already running (PID $PID), reusing"
  fi
fi

if [[ "$DNSMASQ_RUNNING" == "false" ]]; then
  # Clean up stale files
  rm -f "$PID_FILE" "$LEASE_FILE"

  dnsmasq \
    --interface="$BRIDGE_NAME" \
    --bind-interfaces \
    --dhcp-range="${DHCP_RANGE_START},${DHCP_RANGE_END},12h" \
    --dhcp-option=option:router,"$BRIDGE_IP" \
    --dhcp-option=option:dns-server,"$BRIDGE_IP" \
    --no-resolv \
    --server=8.8.8.8 \
    --server=1.1.1.1 \
    --pid-file="$PID_FILE" \
    --dhcp-leasefile="$LEASE_FILE" \
    --keep-in-foreground \
    --log-dhcp &

  # Wait for dnsmasq to write PID file
  sleep 0.5
  if [[ -f "$PID_FILE" ]]; then
    echo "dnsmasq started (PID $(cat "$PID_FILE"))"
  else
    echo "Warning: dnsmasq may not have started (no PID file)"
  fi
fi

# ── 7. Write config JSON ────────────────────────────────────────────────────
cat > "$CONFIG_PATH" <<EOF
{
  "bridgeName": "${BRIDGE_NAME}",
  "bridgeIp": "${BRIDGE_IP}",
  "subnet": "${SUBNET}",
  "leaseFile": "${LEASE_FILE}",
  "taps": ${TAPS_JSON}
}
EOF

# Make config readable by non-root users
chmod 644 "$CONFIG_PATH"

echo ""
echo "=== Setup complete ==="
echo "  Config written to: $CONFIG_PATH"
echo "  Bridge: $BRIDGE_NAME ($BRIDGE_CIDR)"
echo "  TAP pool: $TAP_COUNT devices"
echo "  DHCP: $DHCP_RANGE_START - $DHCP_RANGE_END"
echo "  NAT: $SUBNET -> $OUT_IFACE"
echo ""
echo "Start the server (no sudo needed):"
echo "  bun server.js"
