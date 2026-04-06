#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 06-validate-boot.sh
# Validate the guest image can boot successfully.
#
# Primary mode: QEMU boot test with serial capture
# Fallback mode: static validation of all components
#
# Exits 0 only if validation passes.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "${SCRIPT_DIR}")"
DIST_DIR="${ROOT_DIR}/dist/guest"

. "${SCRIPT_DIR}/_platform.sh"
ROOTFS_DIR="${DIST_DIR}/rootfs"

# Default 120s; cross-arch emulation (e.g. ARM host running i386 guest) is much slower
BOOT_TIMEOUT="${CODEBAUX_BOOT_TIMEOUT:-120}"
BOOT_LOG="${DIST_DIR}/boot.log"
METRICS_FILE="${DIST_DIR}/boot-metrics.txt"

echo "[06] Validating boot sequence..."

# ─── Static validation (always runs) ───
echo "[06] Running static validation..."
STATIC_OK=true

# Kernel exists and is nonzero
if [[ -f "${DIST_DIR}/vmlinuz-lts" ]]; then
    K_SIZE=$(file_size "${DIST_DIR}/vmlinuz-lts")
    if [[ ${K_SIZE} -gt 0 ]]; then
        echo "  OK: vmlinuz-lts (${K_SIZE} bytes)"
        # Check if within budget (< 8MB hard limit)
        if [[ ${K_SIZE} -gt 8388608 ]]; then
            echo "  WARN: kernel exceeds 8MB hard limit"
        fi
    else
        echo "  FAIL: vmlinuz-lts is empty"
        STATIC_OK=false
    fi
else
    echo "  FAIL: vmlinuz-lts not found"
    STATIC_OK=false
fi

# Initramfs exists and is nonzero
if [[ -f "${DIST_DIR}/initramfs-lts" ]]; then
    I_SIZE=$(file_size "${DIST_DIR}/initramfs-lts")
    if [[ ${I_SIZE} -gt 0 ]]; then
        echo "  OK: initramfs-lts (${I_SIZE} bytes)"
    else
        echo "  FAIL: initramfs-lts is empty"
        STATIC_OK=false
    fi
else
    echo "  FAIL: initramfs-lts not found"
    STATIC_OK=false
fi

# Rootfs has critical paths
for path in \
    "usr/bin/node" \
    "bin/bash" \
    "usr/local/bin/serial-listener" \
    "usr/local/bin/receive-project" \
    "usr/local/bin/run-project" \
    "usr/local/bin/stop-project" \
    "etc/codebaux/protocol.conf" \
    "etc/init.d/codebaux-serial" \
    "workspace"; do
    if [[ -e "${ROOTFS_DIR}/${path}" ]]; then
        echo "  OK: /${path}"
    else
        echo "  FAIL: /${path} missing"
        STATIC_OK=false
    fi
done

# Check service is in default runlevel
if [[ -L "${ROOTFS_DIR}/etc/runlevels/default/codebaux-serial" ]]; then
    echo "  OK: codebaux-serial in default runlevel"
else
    echo "  FAIL: codebaux-serial not in default runlevel"
    STATIC_OK=false
fi

# Check inittab has serial console
if grep -q "ttyS0" "${ROOTFS_DIR}/etc/inittab" 2>/dev/null; then
    echo "  OK: ttyS0 in inittab"
else
    echo "  FAIL: ttyS0 not in inittab"
    STATIC_OK=false
fi

# Check 9p is in initramfs config
if grep -q "9p" "${ROOTFS_DIR}/etc/mkinitfs/mkinitfs.conf" 2>/dev/null; then
    echo "  OK: 9p in mkinitfs features"
else
    echo "  FAIL: 9p not in mkinitfs features"
    STATIC_OK=false
fi

if [[ "${STATIC_OK}" != "true" ]]; then
    echo ""
    echo "[06] FAILED: Static validation found errors."
    exit 1
fi

echo ""
echo "[06] Static validation passed."

# ─── QEMU boot test (if available) ───
if command -v qemu-system-i386 &>/dev/null; then
    echo ""
    echo "[06] QEMU detected. Running live boot test..."
    echo "    Timeout: ${BOOT_TIMEOUT}s"

    rm -f "${BOOT_LOG}"
    START_TIME=$(date +%s)

    # Launch QEMU with:
    #   - kernel + initramfs direct boot
    #   - 9p rootfs share
    #   - serial output to file
    #   - no display
    qemu-system-i386 \
        -kernel "${DIST_DIR}/vmlinuz-lts" \
        -initrd "${DIST_DIR}/initramfs-lts" \
        -append "rw root=host9p rootfstype=9p rootflags=trans=virtio,version=9p2000.L,cache=loose console=ttyS0 nowatchdog quiet" \
        -fsdev "local,id=root9p,path=${ROOTFS_DIR},security_model=none" \
        -device "virtio-9p-pci,fsdev=root9p,mount_tag=host9p" \
        -m 128M \
        -nographic \
        -serial "file:${BOOT_LOG}" \
        -no-reboot \
        -pidfile /tmp/codebaux-qemu.pid &

    QEMU_PID=$!

    # Wait for GUEST_READY or timeout
    READY_FOUND=false
    for i in $(seq 1 ${BOOT_TIMEOUT}); do
        if [[ -f "${BOOT_LOG}" ]] && grep -q "GUEST_READY" "${BOOT_LOG}" 2>/dev/null; then
            READY_FOUND=true
            break
        fi
        # Check QEMU is still running
        if ! kill -0 "${QEMU_PID}" 2>/dev/null; then
            echo "  WARN: QEMU exited early"
            break
        fi
        sleep 1
    done

    # Record timing
    END_TIME=$(date +%s)
    BOOT_ELAPSED=$((END_TIME - START_TIME))

    # Kill QEMU
    kill "${QEMU_PID}" 2>/dev/null || true
    wait "${QEMU_PID}" 2>/dev/null || true
    rm -f /tmp/codebaux-qemu.pid

    if [[ "${READY_FOUND}" == "true" ]]; then
        echo "  OK: GUEST_READY detected in ${BOOT_ELAPSED}s"
        echo "boot_time_qemu_seconds=${BOOT_ELAPSED}" > "${METRICS_FILE}"
        echo "boot_test=pass" >> "${METRICS_FILE}"
        echo "boot_test_date=$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "${METRICS_FILE}"
    else
        echo "  FAIL: GUEST_READY not detected within ${BOOT_TIMEOUT}s"
        echo ""
        echo "  Last 30 lines of boot log:"
        tail -30 "${BOOT_LOG}" 2>/dev/null | sed 's/^/    /'
        echo "boot_time_qemu_seconds=timeout" > "${METRICS_FILE}"
        echo "boot_test=fail" >> "${METRICS_FILE}"
        exit 1
    fi
else
    echo ""
    echo "[06] QEMU not available. Skipping live boot test."
    echo "    Install qemu-system-i386 for live boot validation."
    echo "    Static validation passed — proceeding with build."
    echo "boot_test=static_only" > "${METRICS_FILE}"
    echo "boot_test_date=$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "${METRICS_FILE}"
fi

echo ""
echo "[06] Boot validation complete. Metrics written to ${METRICS_FILE}"
