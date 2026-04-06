#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 09-deploy.sh
# Copy guest artifacts to a host application's public directory.
#
# Usage:
#   09-deploy.sh <target-dir>
#
# Copies only the files needed at runtime (skips build logs,
# test results, and the example config).
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "${SCRIPT_DIR}")"
DIST_DIR="${ROOT_DIR}/dist/guest"

TARGET="${1:-}"

if [[ -z "${TARGET}" ]]; then
    echo "[09] ERROR: No target directory specified."
    echo "  Usage: $0 <target-dir>"
    echo "  Example: $0 ../my-app/public/guest"
    exit 1
fi

if [[ ! -d "${DIST_DIR}" ]]; then
    echo "[09] ERROR: dist/guest/ not found. Run the build first."
    exit 1
fi

echo "[09] Deploying guest artifacts to ${TARGET}..."

mkdir -p "${TARGET}"

# Runtime artifacts only — skip logs, test results, example config
ARTIFACTS=(
    vmlinuz-lts
    initramfs-lts
    fs.json
    v86.wasm
    libv86.js
    seabios.bin
    vgabios.bin
    manifest.json
)

for artifact in "${ARTIFACTS[@]}"; do
    src="${DIST_DIR}/${artifact}"
    if [[ -f "${src}" ]]; then
        cp "${src}" "${TARGET}/${artifact}"
        echo "  ${artifact}"
    else
        echo "  SKIP: ${artifact} (not found)"
    fi
done

# rootfs directory (recursive)
# Use cp instead of rsync — rootfs may contain suid binaries
# that aren't readable without elevated privileges, but v86
# serves them via 9p/HTTP so permissions don't matter.
if [[ -d "${DIST_DIR}/rootfs" ]]; then
    rm -rf "${TARGET}/rootfs"
    # --ignore-errors: skip unreadable suid binaries (not needed for 9p/HTTP serving)
    # exit 23 = partial transfer (expected), treat as success
    rsync -rl --ignore-errors "${DIST_DIR}/rootfs/" "${TARGET}/rootfs/" 2>/dev/null || [[ $? -eq 23 ]]
    echo "  rootfs/"
else
    echo "  SKIP: rootfs/ (not found)"
fi

echo ""
echo "[09] Deployed to ${TARGET}"
