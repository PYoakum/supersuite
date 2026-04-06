#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 05-configure-init.sh
# Wire the boot process: enable the codebaux-serial OpenRC
# service, configure serial console output, and ensure
# GUEST_READY is emitted on boot completion.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "${SCRIPT_DIR}")"
DIST_DIR="${ROOT_DIR}/dist/guest"
ROOTFS_DIR="${DIST_DIR}/rootfs"

echo "[05] Configuring init sequence and serial output..."

if [[ ! -d "${ROOTFS_DIR}" ]]; then
    echo "[05] ERROR: Rootfs not found at ${ROOTFS_DIR}. Run step 02 first."
    exit 1
fi

# ─── Validate service script exists ───
SERVICE_SCRIPT="${ROOTFS_DIR}/etc/init.d/codebaux-serial"
if [[ ! -f "${SERVICE_SCRIPT}" ]]; then
    echo "[05] ERROR: /etc/init.d/codebaux-serial not found. Run step 03 first."
    exit 1
fi

# ─── Enable the OpenRC service ───
# In a real Alpine rootfs, this creates a symlink in the runlevel directory.
# Since we can't run rc-update inside the host, we create the link manually.
echo "[05] Enabling codebaux-serial in default runlevel..."
RUNLEVEL_DIR="${ROOTFS_DIR}/etc/runlevels/default"
mkdir -p "${RUNLEVEL_DIR}"

ln -sf /etc/init.d/codebaux-serial "${RUNLEVEL_DIR}/codebaux-serial"
echo "  Linked /etc/runlevels/default/codebaux-serial"

# ─── Verify inittab has ttyS0 entry ───
echo "[05] Verifying serial console in inittab..."
INITTAB="${ROOTFS_DIR}/etc/inittab"

if [[ ! -f "${INITTAB}" ]]; then
    echo "[05] ERROR: /etc/inittab not found."
    exit 1
fi

if grep -q "ttyS0" "${INITTAB}"; then
    echo "  OK: ttyS0 entry found in inittab"
    grep "ttyS0" "${INITTAB}" | head -1 | sed 's/^/    /'
else
    echo "  WARN: ttyS0 not in inittab, adding..."
    echo 'ttyS0::respawn:/sbin/agetty --autologin root -s ttyS0 115200 vt100' >> "${INITTAB}"
    echo "  Added ttyS0 auto-login entry"
fi

# ─── Ensure boot services are enabled ───
# These are typically already enabled in Alpine but verify
echo "[05] Checking essential boot services..."
for service in devfs dmesg mdev hwdrivers; do
    BOOT_RUNLEVEL="${ROOTFS_DIR}/etc/runlevels/boot"
    mkdir -p "${BOOT_RUNLEVEL}"
    if [[ -f "${ROOTFS_DIR}/etc/init.d/${service}" ]]; then
        if [[ ! -L "${BOOT_RUNLEVEL}/${service}" ]]; then
            ln -sf "/etc/init.d/${service}" "${BOOT_RUNLEVEL}/${service}"
            echo "  Enabled ${service} in boot runlevel"
        else
            echo "  OK: ${service} already in boot runlevel"
        fi
    fi
done

# ─── Write boot cmdline reference ───
# This is documentation for the host-side V86Starter config.
# The actual cmdline is passed by the host, not by the guest.
cat > "${ROOTFS_DIR}/etc/codebaux/cmdline.reference" <<'EOF'
# v86 kernel command line (passed by host V86Starter config)
# Do not modify this file — it is for reference only.
#
# rw root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose console=ttyS0 nowatchdog quiet
#
# Flags:
#   rw                          Mount root read-write
#   root=host9p                 Mount tag for 9p virtual filesystem
#   rootfstype=9p               Use 9p filesystem driver
#   rootflags=trans=virtio,...  Virtio transport, loose caching for performance
#   console=ttyS0               Route kernel console to serial (host captures this)
#   nowatchdog                  Disable watchdog (unnecessary in emulated env)
#   quiet                       Suppress non-critical kernel messages
EOF
echo "  Wrote /etc/codebaux/cmdline.reference"

# ─── Disable unnecessary services to speed boot ───
echo "[05] Disabling unnecessary services..."
for service in networking ntpd sshd crond; do
    SYMLINK="${ROOTFS_DIR}/etc/runlevels/default/${service}"
    if [[ -L "${SYMLINK}" ]]; then
        rm -f "${SYMLINK}"
        echo "  Disabled ${service} (not needed in sandbox)"
    fi
done

# ─── Verification ───
echo ""
echo "[05] Verification:"

# Service linked
if [[ -L "${RUNLEVEL_DIR}/codebaux-serial" ]]; then
    echo "  OK: codebaux-serial enabled in default runlevel"
else
    echo "  FAIL: codebaux-serial not linked"
fi

# Service script executable
if [[ -x "${SERVICE_SCRIPT}" ]]; then
    echo "  OK: /etc/init.d/codebaux-serial is executable"
else
    echo "  FAIL: /etc/init.d/codebaux-serial not executable"
fi

# serial-listener exists
if [[ -x "${ROOTFS_DIR}/usr/local/bin/serial-listener" ]]; then
    echo "  OK: /usr/local/bin/serial-listener is executable"
else
    echo "  WARN: serial-listener not yet installed (run step 04)"
fi

# inittab has ttyS0
if grep -q "ttyS0" "${INITTAB}"; then
    echo "  OK: inittab contains ttyS0 entry"
else
    echo "  FAIL: inittab missing ttyS0"
fi

echo ""
echo "[05] Init sequence configured successfully."
echo "    Boot cmdline for host: rw root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose console=ttyS0 nowatchdog quiet"
