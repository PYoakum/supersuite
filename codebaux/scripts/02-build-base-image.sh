#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 02-build-base-image.sh
# Build an i386 Alpine Linux image via Docker and extract the
# rootfs, kernel, and initramfs for v86 consumption.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "${SCRIPT_DIR}")"
DIST_DIR="${ROOT_DIR}/dist/guest"
DOCKER_DIR="${ROOT_DIR}/guest/docker"
ROOTFS_DIR="${DIST_DIR}/rootfs"

. "${SCRIPT_DIR}/_platform.sh"

IMAGE_NAME="codebaux-guest"
CONTAINER_NAME="codebaux-extract"

echo "[02] Building base Alpine guest image..."

# ─── Pre-flight checks ───
if ! command -v docker &>/dev/null; then
    echo "[02] ERROR: Docker is required but not found."
    echo "    Install Docker 20.10+ and ensure the daemon is running."
    exit 1
fi

if ! docker info &>/dev/null; then
    echo "[02] ERROR: Docker daemon is not running or not accessible."
    exit 1
fi

# ─── Clean previous artifacts ───
echo "[02] Cleaning previous rootfs..."
rm -rf "${ROOTFS_DIR}"
mkdir -p "${ROOTFS_DIR}"

# Remove stale container if present
docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true

# ─── Build the Docker image ───
echo "[02] Building Docker image (platform: linux/386)..."
echo "    Dockerfile: ${DOCKER_DIR}/Dockerfile"

docker build \
    --platform linux/386 \
    -t "${IMAGE_NAME}" \
    -f "${DOCKER_DIR}/Dockerfile" \
    "${DOCKER_DIR}" 2>&1 | while IFS= read -r line; do
    echo "    [docker] ${line}"
done

if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
    echo "[02] ERROR: Docker build failed."
    exit 1
fi

echo "[02] Docker image built successfully."

# ─── Create container (don't start) ───
echo "[02] Creating container for export..."
docker create --name "${CONTAINER_NAME}" "${IMAGE_NAME}" /bin/true > /dev/null

# ─── Export filesystem ───
echo "[02] Exporting rootfs..."
docker export "${CONTAINER_NAME}" | tar -xf - -C "${ROOTFS_DIR}"

echo "[02] Rootfs exported to ${ROOTFS_DIR}"

# ─── Extract kernel and initramfs ───
echo "[02] Extracting kernel and initramfs..."

# Find the kernel
KERNEL_FILE=""
for candidate in \
    "${ROOTFS_DIR}/boot/vmlinuz-lts" \
    "${ROOTFS_DIR}/boot/vmlinuz-"*; do
    if [[ -f "${candidate}" ]]; then
        KERNEL_FILE="${candidate}"
        break
    fi
done

if [[ -z "${KERNEL_FILE}" ]]; then
    echo "[02] ERROR: Kernel not found in rootfs /boot/"
    ls -la "${ROOTFS_DIR}/boot/" 2>/dev/null || echo "    /boot/ does not exist"
    exit 1
fi

cp "${KERNEL_FILE}" "${DIST_DIR}/vmlinuz-lts"
echo "[02] Kernel: $(basename "${KERNEL_FILE}") ($(file_size "${DIST_DIR}/vmlinuz-lts") bytes)"

# Find the initramfs
INITRD_FILE=""
for candidate in \
    "${ROOTFS_DIR}/boot/initramfs-lts" \
    "${ROOTFS_DIR}/boot/initramfs-"*; do
    if [[ -f "${candidate}" ]]; then
        INITRD_FILE="${candidate}"
        break
    fi
done

if [[ -z "${INITRD_FILE}" ]]; then
    echo "[02] ERROR: Initramfs not found in rootfs /boot/"
    ls -la "${ROOTFS_DIR}/boot/" 2>/dev/null
    exit 1
fi

cp "${INITRD_FILE}" "${DIST_DIR}/initramfs-lts"
echo "[02] Initramfs: $(basename "${INITRD_FILE}") ($(file_size "${DIST_DIR}/initramfs-lts") bytes)"

# ─── Clean up Docker container ───
docker rm -f "${CONTAINER_NAME}" > /dev/null 2>&1

# ─── Verification ───
echo ""
echo "[02] Verification:"

# Check critical binaries
for bin in usr/bin/node bin/bash bin/sh; do
    if [[ -f "${ROOTFS_DIR}/${bin}" || -L "${ROOTFS_DIR}/${bin}" ]]; then
        echo "  OK: /${bin} present"
    else
        echo "  FAIL: /${bin} missing"
    fi
done

# Check kernel modules
MODULES_DIR=$(find "${ROOTFS_DIR}/lib/modules" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | head -1)
if [[ -n "${MODULES_DIR}" ]]; then
    echo "  OK: kernel modules at ${MODULES_DIR#${ROOTFS_DIR}}"
else
    echo "  WARN: no kernel modules directory found"
fi

# Log Node version
NODE_VERSION=$("${ROOTFS_DIR}/usr/bin/node" --version 2>/dev/null || echo "unknown")
echo "  INFO: Node.js version: ${NODE_VERSION}"

# Check sizes
KERNEL_SIZE=$(file_size "${DIST_DIR}/vmlinuz-lts")
INITRD_SIZE=$(file_size "${DIST_DIR}/initramfs-lts")
ROOTFS_SIZE=$(dir_size "${ROOTFS_DIR}")
echo "  INFO: kernel=${KERNEL_SIZE} bytes, initramfs=${INITRD_SIZE} bytes, rootfs=${ROOTFS_SIZE} bytes"

echo ""
echo "[02] Base image build complete."
