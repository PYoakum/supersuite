#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 08-package.sh
# Produce final distribution artifacts:
#   - fs.json filesystem manifest for v86 9p loader
#   - Size report and budget check
#   - Optional: initial state snapshot (if v86 headless available)
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "${SCRIPT_DIR}")"
DIST_DIR="${ROOT_DIR}/dist/guest"
ROOTFS_DIR="${DIST_DIR}/rootfs"

. "${SCRIPT_DIR}/_platform.sh"

echo "[08] Packaging final artifacts..."

if [[ ! -d "${ROOTFS_DIR}" ]]; then
    echo "[08] ERROR: Rootfs not found at ${ROOTFS_DIR}."
    exit 1
fi

# ─── Generate fs.json manifest ───
# v86 uses fs.json to index every file in the 9p rootfs.
# The v86 project provides tools/fs2json.py for this.
# If that tool is not available, we generate a compatible manifest ourselves.

echo "[08] Generating filesystem manifest (fs.json)..."

FS_JSON="${DIST_DIR}/fs.json"

# Check if v86's fs2json.py is available
FS2JSON=""
for candidate in \
    "${ROOT_DIR}/vendor/v86/tools/fs2json.py" \
    "$(which fs2json.py 2>/dev/null || true)"; do
    if [[ -n "${candidate}" && -f "${candidate}" ]]; then
        FS2JSON="${candidate}"
        break
    fi
done

if [[ -n "${FS2JSON}" ]]; then
    echo "  Using v86 fs2json.py: ${FS2JSON}"
    python3 "${FS2JSON}" \
        --exclude "/.dockerenv" \
        --out "${FS_JSON}" \
        "${ROOTFS_DIR}"
else
    echo "  v86 fs2json.py not found. Generating compatible manifest..."
    # Generate a minimal fs.json that v86 can consume.
    # Format: JSON object mapping paths to [size, mtime] pairs.
    # This is a simplified version; the full v86 fs2json includes
    # directory structure and uid/gid/mode.
    python3 -c "
import json, os, stat

def walk_fs(root):
    result = {}
    for dirpath, dirnames, filenames in os.walk(root):
        reldir = os.path.relpath(dirpath, root)
        if reldir == '.':
            reldir = ''

        # Skip .dockerenv
        if '.dockerenv' in filenames:
            filenames.remove('.dockerenv')

        for name in sorted(dirnames + filenames):
            fullpath = os.path.join(dirpath, name)
            relpath = os.path.join(reldir, name) if reldir else name
            relpath = '/' + relpath

            try:
                st = os.lstat(fullpath)
                result[relpath] = {
                    'size': st.st_size,
                    'mtime': int(st.st_mtime),
                    'mode': stat.S_IMODE(st.st_mode),
                    'is_dir': stat.S_ISDIR(st.st_mode),
                    'is_link': stat.S_ISLNK(st.st_mode),
                }
                if stat.S_ISLNK(st.st_mode):
                    result[relpath]['target'] = os.readlink(fullpath)
            except OSError:
                pass

    return result

root = '${ROOTFS_DIR}'
manifest = walk_fs(root)
with open('${FS_JSON}', 'w') as f:
    json.dump(manifest, f, separators=(',', ':'))
print(f'  Indexed {len(manifest)} entries')
" 2>&1
fi

if [[ -f "${FS_JSON}" ]]; then
    FS_SIZE=$(file_size "${FS_JSON}")
    echo "  OK: fs.json generated (${FS_SIZE} bytes)"

    # Validate it's valid JSON
    if command -v jq &>/dev/null; then
        if jq empty "${FS_JSON}" 2>/dev/null; then
            ENTRY_COUNT=$(jq 'length' "${FS_JSON}" 2>/dev/null || echo "unknown")
            echo "  OK: valid JSON (${ENTRY_COUNT} entries)"
        else
            echo "  WARN: fs.json may not be valid JSON"
        fi
    elif command -v python3 &>/dev/null; then
        if python3 -c "import json; json.load(open('${FS_JSON}'))" 2>/dev/null; then
            echo "  OK: valid JSON (verified via python)"
        else
            echo "  WARN: fs.json validation failed"
        fi
    fi
else
    echo "  FAIL: fs.json was not generated"
    exit 1
fi

# ─── Write V86Starter configuration reference ───
echo "[08] Writing host configuration reference..."
cat > "${DIST_DIR}/v86-config.js.example" <<'EOF'
// V86Starter configuration for the Codebaux guest image.
// Copy this into the host application's emulator initialization.
//
// Adjust URLs to match your serving path.

const emulator = new V86Starter({
    wasm_path: "/guest/v86.wasm",
    memory_size: 64 * 1024 * 1024,      // 64 MB
    vga_memory_size: 2 * 1024 * 1024,    // 2 MB

    // Screen container (for emulator pane)
    screen_container: document.getElementById("v86-screen"),

    // Kernel and initramfs (direct boot, no BIOS boot sequence)
    bzimage: { url: "/guest/vmlinuz-lts" },
    initrd:  { url: "/guest/initramfs-lts" },

    // BIOS ROMs
    bios:    { url: "/guest/seabios.bin" },
    vga_bios:{ url: "/guest/vgabios.bin" },

    // 9p root filesystem
    filesystem: {
        baseurl: "/guest/rootfs/",
        basefs:  "/guest/fs.json",
    },

    // Do not load bzimage/initrd from the 9p filesystem
    bzimage_initrd_from_filesystem: false,

    // Kernel command line
    cmdline: [
        "rw",
        "root=host9p",
        "rootfstype=9p",
        "rootflags=trans=virtio,cache=loose",
        "console=ttyS0",
        "nowatchdog",
        "quiet",
    ].join(" "),

    // Optional: saved initial state for fast boot (~2s instead of ~20s)
    // initial_state: { url: "/guest/state.bin" },

    autostart: true,

    // Disable ACPI (not needed, avoids overhead)
    acpi: false,
});

// Listen for serial output (guest → host protocol)
emulator.add_listener("serial0-output-byte", function(byte) {
    // Accumulate bytes into lines, then parse protocol messages
    // See V86Bridge class in codebaux.jsx
});
EOF
echo "  Wrote v86-config.js.example"

# ─── Size report and budget check ───
echo ""
echo "[08] Artifact size report:"
echo "─────────────────────────────────────────"

SIZE_OK=true

check_size() {
    local name=$1 path=$2 target=$3 limit=$4
    if [[ -f "${path}" ]]; then
        local size=$(file_size "${path}")
        local size_mb=$(echo "scale=2; ${size} / 1048576" | bc 2>/dev/null || echo "?")
        local status="OK"
        if [[ ${size} -gt ${limit} ]]; then
            status="OVER LIMIT"
            SIZE_OK=false
        elif [[ ${size} -gt ${target} ]]; then
            status="WARN"
        fi
        printf "  %-20s %8s MB  target: %-8s  limit: %-8s  [%s]\n" \
            "${name}" "${size_mb}" \
            "$(echo "scale=1; ${target} / 1048576" | bc 2>/dev/null || echo "?")" \
            "$(echo "scale=1; ${limit} / 1048576" | bc 2>/dev/null || echo "?")" \
            "${status}"
    else
        printf "  %-20s  (not found)\n" "${name}"
    fi
}

check_dir_size() {
    local name=$1 path=$2 target=$3 limit=$4
    if [[ -d "${path}" ]]; then
        local size=$(dir_size "${path}")
        local size_mb=$(echo "scale=2; ${size} / 1048576" | bc 2>/dev/null || echo "?")
        local status="OK"
        if [[ ${size} -gt ${limit} ]]; then
            status="OVER LIMIT"
            SIZE_OK=false
        elif [[ ${size} -gt ${target} ]]; then
            status="WARN"
        fi
        printf "  %-20s %8s MB  target: %-8s  limit: %-8s  [%s]\n" \
            "${name}" "${size_mb}" \
            "$(echo "scale=1; ${target} / 1048576" | bc 2>/dev/null || echo "?")" \
            "$(echo "scale=1; ${limit} / 1048576" | bc 2>/dev/null || echo "?")" \
            "${status}"
    fi
}

#                         name                path                              target_bytes   limit_bytes
check_size    "vmlinuz-lts"      "${DIST_DIR}/vmlinuz-lts"                      5242880        8388608
check_size    "initramfs-lts"    "${DIST_DIR}/initramfs-lts"                    3145728        5242880
check_dir_size "rootfs/"          "${ROOTFS_DIR}"                                62914560       104857600
check_size    "fs.json"          "${FS_JSON}"                                   1048576        2097152
check_size    "v86.wasm"         "${DIST_DIR}/v86.wasm"                         1572864        3145728
check_size    "state.bin"        "${DIST_DIR}/state.bin"                        20971520       41943040

# Total
TOTAL_SIZE=$(dir_size "${DIST_DIR}")
TOTAL_MB=$(echo "scale=2; ${TOTAL_SIZE} / 1048576" | bc 2>/dev/null || echo "?")
echo "─────────────────────────────────────────"
printf "  %-20s %8s MB\n" "TOTAL" "${TOTAL_MB}"

echo ""

if [[ "${SIZE_OK}" != "true" ]]; then
    echo "[08] WARNING: One or more artifacts exceed their hard size limit."
    echo "    Consider trimming the rootfs (remove unused packages, locales, etc.)"
fi

# ─── Final manifest ───
echo "[08] Writing build manifest..."
cat > "${DIST_DIR}/manifest.json" <<EOF
{
  "build_date": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "artifacts": {
    "vmlinuz":   "vmlinuz-lts",
    "initramfs": "initramfs-lts",
    "rootfs":    "rootfs/",
    "fs_json":   "fs.json",
    "v86_wasm":  "v86.wasm",
    "bios":      "seabios.bin",
    "vga_bios":  "vgabios.bin"
  },
  "cmdline": "rw root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose console=ttyS0 nowatchdog quiet",
  "total_size_bytes": ${TOTAL_SIZE}
}
EOF
echo "  Wrote manifest.json"

echo ""
echo "[08] Packaging complete. All artifacts in: ${DIST_DIR}/"
