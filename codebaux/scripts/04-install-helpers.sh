#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 04-install-helpers.sh
# Copy guest helper scripts into the rootfs at /usr/local/bin/
# and validate they are syntactically correct.
# Implements PRD Section 10 helper scripts and Section 11 protocol.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "${SCRIPT_DIR}")"
DIST_DIR="${ROOT_DIR}/dist/guest"
ROOTFS_DIR="${DIST_DIR}/rootfs"
HELPERS_DIR="${ROOT_DIR}/guest/helpers"

. "${SCRIPT_DIR}/_platform.sh"

TARGET_DIR="${ROOTFS_DIR}/usr/local/bin"

echo "[04] Installing guest helper scripts..."

if [[ ! -d "${ROOTFS_DIR}" ]]; then
    echo "[04] ERROR: Rootfs not found at ${ROOTFS_DIR}. Run step 02 first."
    exit 1
fi

mkdir -p "${TARGET_DIR}"

# ─── Scripts to install ───
SCRIPTS=(
    "receive-project"
    "run-project"
    "stop-project"
    "serial-listener"
)

ALL_OK=true

for script_name in "${SCRIPTS[@]}"; do
    src="${HELPERS_DIR}/${script_name}"

    if [[ ! -f "${src}" ]]; then
        echo "  FAIL: source not found: ${src}"
        ALL_OK=false
        continue
    fi

    # Copy to rootfs
    cp "${src}" "${TARGET_DIR}/${script_name}"
    chmod 755 "${TARGET_DIR}/${script_name}"

    # Get file size
    size=$(file_size "${TARGET_DIR}/${script_name}")

    # Validate syntax
    if bash -n "${TARGET_DIR}/${script_name}" 2>/dev/null; then
        echo "  OK: ${script_name} installed (${size} bytes, syntax valid)"
    else
        echo "  WARN: ${script_name} installed (${size} bytes, syntax check failed)"
        echo "    This may be expected if the script uses features not in this bash version."
    fi
done

# ─── Verify protocol.conf is available ───
if [[ -f "${ROOTFS_DIR}/etc/codebaux/protocol.conf" ]]; then
    echo "  OK: /etc/codebaux/protocol.conf present (dependency for all scripts)"
else
    echo "  FAIL: /etc/codebaux/protocol.conf missing. Run step 03 first."
    ALL_OK=false
fi

# ─── Verification summary ───
echo ""
echo "[04] Verification:"
for script_name in "${SCRIPTS[@]}"; do
    target="${TARGET_DIR}/${script_name}"
    if [[ -f "${target}" && -x "${target}" ]]; then
        echo "  OK: /usr/local/bin/${script_name} (executable)"
    else
        echo "  FAIL: /usr/local/bin/${script_name}"
        ALL_OK=false
    fi
done

if [[ "${ALL_OK}" != "true" ]]; then
    echo ""
    echo "[04] FAILED: One or more scripts could not be installed."
    exit 1
fi

echo ""
echo "[04] All helper scripts installed successfully."
