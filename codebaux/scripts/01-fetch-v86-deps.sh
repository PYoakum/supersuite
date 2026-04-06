#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 01-fetch-v86-deps.sh
# Download v86 WASM binary, JS runtime, and BIOS ROMs.
# These are static host-side assets loaded by V86Starter.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "${SCRIPT_DIR}")"
DIST_DIR="${ROOT_DIR}/dist/guest"

. "${SCRIPT_DIR}/_platform.sh"

# ─── Configuration ───
# Pin to a known-good v86 version
V86_NPM_VERSION="0.5.319"
V86_BIOS_BASE="https://raw.githubusercontent.com/copy/v86/master/bios"

echo "[01] Fetching v86 dependencies..."

mkdir -p "${DIST_DIR}"

# ─── Install v86 npm package into a temp directory ───
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "${TEMP_DIR}"' EXIT

echo "[01] Installing v86@${V86_NPM_VERSION} via npm..."
cd "${TEMP_DIR}"
npm init -y --silent > /dev/null 2>&1
npm install "v86@${V86_NPM_VERSION}" --silent 2>&1 | tail -3

V86_DIR="${TEMP_DIR}/node_modules/v86"

# ─── Copy WASM binary ───
if [[ -f "${V86_DIR}/build/v86.wasm" ]]; then
    cp "${V86_DIR}/build/v86.wasm" "${DIST_DIR}/v86.wasm"
    echo "[01] Copied v86.wasm ($(file_size "${DIST_DIR}/v86.wasm") bytes)"
elif [[ -f "${V86_DIR}/v86.wasm" ]]; then
    cp "${V86_DIR}/v86.wasm" "${DIST_DIR}/v86.wasm"
    echo "[01] Copied v86.wasm ($(file_size "${DIST_DIR}/v86.wasm") bytes)"
else
    echo "[01] ERROR: v86.wasm not found in npm package"
    find "${V86_DIR}" -name "*.wasm" 2>/dev/null
    exit 1
fi

# ─── Copy JS runtime ───
# The npm package exposes the main entry point; find libv86.js or equivalent
for candidate in \
    "${V86_DIR}/build/libv86.js" \
    "${V86_DIR}/build/libv86-debug.js" \
    "${V86_DIR}/libv86.js" \
    "${V86_DIR}/src/browser/starter.js"; do
    if [[ -f "${candidate}" ]]; then
        cp "${candidate}" "${DIST_DIR}/libv86.js"
        echo "[01] Copied libv86.js from $(basename "${candidate}") ($(file_size "${DIST_DIR}/libv86.js") bytes)"
        break
    fi
done

if [[ ! -f "${DIST_DIR}/libv86.js" ]]; then
    # Fallback: use the npm package entry point
    MAIN_FILE=$(node -e "console.log(require.resolve('v86'))" 2>/dev/null || true)
    if [[ -n "${MAIN_FILE}" && -f "${MAIN_FILE}" ]]; then
        cp "${MAIN_FILE}" "${DIST_DIR}/libv86.js"
        echo "[01] Copied libv86.js from npm main entry ($(file_size "${DIST_DIR}/libv86.js") bytes)"
    else
        echo "[01] WARNING: libv86.js not found. The host app may need to import v86 via npm bundler instead."
    fi
fi

# ─── Download BIOS ROMs ───
# BIOS ROMs are not included in the npm package; fetch from the v86 GitHub repo.
for bios in seabios.bin vgabios.bin; do
    # Check npm package first (in case future versions include them)
    found=false
    for search_path in "${V86_DIR}/bios/${bios}" "${V86_DIR}/${bios}"; do
        if [[ -f "${search_path}" ]]; then
            cp "${search_path}" "${DIST_DIR}/${bios}"
            echo "[01] Copied ${bios} from npm package ($(file_size "${DIST_DIR}/${bios}") bytes)"
            found=true
            break
        fi
    done
    if [[ "${found}" != "true" ]]; then
        echo "[01] Downloading ${bios} from v86 repository..."
        if ! curl -fsSL "${V86_BIOS_BASE}/${bios}" -o "${DIST_DIR}/${bios}"; then
            echo "[01] ERROR: Failed to download ${bios}"
            exit 1
        fi
        echo "[01] Downloaded ${bios} ($(file_size "${DIST_DIR}/${bios}") bytes)"
    fi
done

# ─── Verify all artifacts ───
echo ""
echo "[01] Verification:"
ALL_OK=true
for file in v86.wasm seabios.bin vgabios.bin; do
    filepath="${DIST_DIR}/${file}"
    if [[ -f "${filepath}" ]]; then
        size=$(file_size "${filepath}")
        if [[ ${size} -eq 0 ]]; then
            echo "  FAIL: ${file} exists but is empty"
            ALL_OK=false
        else
            hash=$(sha256 "${filepath}")
            echo "  OK: ${file} (${size} bytes, sha256:${hash:0:16}...)"
        fi
    else
        echo "  FAIL: ${file} missing"
        ALL_OK=false
    fi
done

# libv86.js is optional if using npm bundler
if [[ -f "${DIST_DIR}/libv86.js" ]]; then
    size=$(file_size "${DIST_DIR}/libv86.js")
    echo "  OK: libv86.js (${size} bytes)"
else
    echo "  WARN: libv86.js not present (use npm import in bundler)"
fi

if [[ "${ALL_OK}" != "true" ]]; then
    echo ""
    echo "[01] FAILED: One or more required artifacts missing or empty."
    exit 1
fi

echo ""
echo "[01] All v86 dependencies fetched successfully."
