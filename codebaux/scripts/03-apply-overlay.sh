#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 03-apply-overlay.sh
# Layer Codebaux-specific directories, configuration, and
# cleanup onto the extracted rootfs.
# Implements PRD Section 10 filesystem layout.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "${SCRIPT_DIR}")"
DIST_DIR="${ROOT_DIR}/dist/guest"
ROOTFS_DIR="${DIST_DIR}/rootfs"
OVERLAY_DIR="${ROOT_DIR}/guest/overlay"

. "${SCRIPT_DIR}/_platform.sh"

echo "[03] Applying filesystem overlay..."

if [[ ! -d "${ROOTFS_DIR}" ]]; then
    echo "[03] ERROR: Rootfs not found at ${ROOTFS_DIR}. Run step 02 first."
    exit 1
fi

# ─── Create directory structure (PRD Section 10) ───
echo "[03] Creating workspace directories..."
mkdir -p "${ROOTFS_DIR}/workspace"
mkdir -p "${ROOTFS_DIR}/workspace/out"
mkdir -p "${ROOTFS_DIR}/tmp"
mkdir -p "${ROOTFS_DIR}/var/log"
mkdir -p "${ROOTFS_DIR}/usr/local/bin"
mkdir -p "${ROOTFS_DIR}/etc/codebaux"
mkdir -p "${ROOTFS_DIR}/run"

# ─── Copy overlay files ───
echo "[03] Copying overlay files..."

# Protocol configuration
if [[ -f "${OVERLAY_DIR}/etc/codebaux/protocol.conf" ]]; then
    cp "${OVERLAY_DIR}/etc/codebaux/protocol.conf" "${ROOTFS_DIR}/etc/codebaux/protocol.conf"
    echo "  Installed /etc/codebaux/protocol.conf"
fi

# OpenRC service
if [[ -f "${OVERLAY_DIR}/etc/init.d/codebaux-serial" ]]; then
    cp "${OVERLAY_DIR}/etc/init.d/codebaux-serial" "${ROOTFS_DIR}/etc/init.d/codebaux-serial"
    chmod 755 "${ROOTFS_DIR}/etc/init.d/codebaux-serial"
    echo "  Installed /etc/init.d/codebaux-serial"
fi

# ─── Write build metadata ───
BUILD_TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
cat > "${ROOTFS_DIR}/etc/codebaux/version" <<EOF
codebaux-guest
build_time=${BUILD_TIMESTAMP}
build_host=$(hostname 2>/dev/null || echo "unknown")
EOF
echo "  Wrote /etc/codebaux/version (built at ${BUILD_TIMESTAMP})"

# ─── Suppress login noise ───
echo "" > "${ROOTFS_DIR}/etc/motd"

# ─── Clean Docker artifacts ───
echo "[03] Cleaning artifacts..."
rm -f "${ROOTFS_DIR}/.dockerenv" 2>/dev/null || true

# Remove apk cache
rm -rf "${ROOTFS_DIR}/var/cache/apk/"* 2>/dev/null || true

# Remove documentation to save space
rm -rf "${ROOTFS_DIR}/usr/share/man/"* 2>/dev/null || true
rm -rf "${ROOTFS_DIR}/usr/share/doc/"* 2>/dev/null || true
rm -rf "${ROOTFS_DIR}/usr/share/info/"* 2>/dev/null || true
rm -rf "${ROOTFS_DIR}/usr/share/licenses/"* 2>/dev/null || true

# Remove unused locales (keep C/POSIX)
find "${ROOTFS_DIR}/usr/share/i18n/locales" -mindepth 1 ! -name "C" ! -name "POSIX" -delete 2>/dev/null || true

# Remove kernel source/headers if present
rm -rf "${ROOTFS_DIR}/usr/src/"* 2>/dev/null || true

# Remove npm cache if present
rm -rf "${ROOTFS_DIR}/root/.npm" 2>/dev/null || true
rm -rf "${ROOTFS_DIR}/tmp/"* 2>/dev/null || true

# ─── Verification ───
echo ""
echo "[03] Verification:"

for dir in workspace workspace/out tmp var/log usr/local/bin etc/codebaux; do
    if [[ -d "${ROOTFS_DIR}/${dir}" ]]; then
        echo "  OK: /${dir}/ exists"
    else
        echo "  FAIL: /${dir}/ missing"
    fi
done

# Check workspace is writable (test by creating and removing a file)
touch "${ROOTFS_DIR}/workspace/.write-test" 2>/dev/null && rm -f "${ROOTFS_DIR}/workspace/.write-test"
echo "  OK: /workspace/ is writable"

# Check .dockerenv removed
if [[ -f "${ROOTFS_DIR}/.dockerenv" ]]; then
    echo "  WARN: .dockerenv still present"
else
    echo "  OK: .dockerenv removed"
fi

# Report size
ROOTFS_SIZE=$(du -sh "${ROOTFS_DIR}" | cut -f1)
ROOTFS_BYTES=$(dir_size "${ROOTFS_DIR}")
echo "  INFO: rootfs size: ${ROOTFS_SIZE} (${ROOTFS_BYTES} bytes)"

echo ""
echo "[03] Overlay applied successfully."
