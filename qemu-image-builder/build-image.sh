#!/bin/bash

# build-image.sh - Build QEMU VM images (qcow2 rootfs)
# Works on both macOS (via Docker) and Linux (native)
#
# Usage: ./build-image.sh [options]
#        ./build-image.sh              # Launch interactive TUI (if terminal)
#        ./build-image.sh -i           # Force interactive TUI mode
#
# Produces:
#   - <name>.qcow2: QEMU copy-on-write disk image

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source TUI library if available
if [ -f "$SCRIPT_DIR/../lib/tui.sh" ]; then
    source "$SCRIPT_DIR/../lib/tui.sh"
    TUI_AVAILABLE=true
else
    TUI_AVAILABLE=false
fi

# Interactive mode detection
INTERACTIVE_MODE=false

# Check for -i/--interactive flag first
for arg in "$@"; do
    case "$arg" in
        -i|--interactive)
            INTERACTIVE_MODE=true
            ;;
    esac
done

# No args + terminal = TUI mode (if TUI available)
if [ $# -eq 0 ] && [ -t 0 ] && [ -t 1 ] && $TUI_AVAILABLE; then
    INTERACTIVE_MODE=true
fi

# Defaults
IMAGE_NAME="qemu-vm"
IMAGE_SIZE="8G"
DEBIAN_RELEASE="bookworm"
OUTPUT_DIR="../vm-provisioner/images"
ROOT_PASSWORD=""
SSH_KEY=""
PACKAGES="openssh-server,sudo,curl,ca-certificates,systemd-sysv,linux-image-amd64,grub-pc"
EXTRA_PACKAGES=""
HOSTNAME="qemu-vm"
DOCKER_IMAGE="debian:bookworm"
FORMAT="qcow2"

# Platform detection
PLATFORM="$(uname)"
IS_MACOS=false
IS_LINUX=false

if [ "$PLATFORM" = "Darwin" ]; then
    IS_MACOS=true
elif [ "$PLATFORM" = "Linux" ]; then
    IS_LINUX=true
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
    cat << EOF
Usage: $0 [options]

Build QEMU VM images (qcow2) on macOS or Linux.

Options:
  -i, --interactive       Launch interactive TUI mode
  -n, --name NAME         Image name (default: qemu-vm)
  -s, --size SIZE         Disk size with unit (default: 8G)
  -r, --release RELEASE   Debian release: bullseye, bookworm, trixie (default: bookworm)
  -o, --output DIR        Output directory (default: ../vm-provisioner/images)
  -f, --format FORMAT     Image format: qcow2, raw (default: qcow2)
  -p, --password PASS     Root password (default: random, printed at end)
  -K, --ssh-key KEY       SSH public key to add to root's authorized_keys
  -P, --packages PKGS     Extra packages to install (comma-separated)
  -H, --hostname NAME     VM hostname (default: qemu-vm)
  -h, --help              Show this help

Note: Running without arguments in a terminal launches interactive TUI mode.

Examples:
  $0                                    # Build with defaults
  $0 -n myvm -s 16G -r bookworm         # 16GB bookworm image
  $0 -K "\$(cat ~/.ssh/id_rsa.pub)"       # Add SSH key
  $0 -P "nginx,vim" -H webserver        # Add packages, set hostname

Platform: $PLATFORM
$(if $IS_MACOS; then echo "  macOS detected - will use Docker for image building"; fi)

Output files:
  <output>/<name>.qcow2    - QEMU disk image (bootable)
EOF
    exit 0
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -i|--interactive)
                # Already handled above
                shift
                ;;
            -n|--name)
                IMAGE_NAME="$2"
                shift 2
                ;;
            -s|--size)
                IMAGE_SIZE="$2"
                shift 2
                ;;
            -r|--release)
                DEBIAN_RELEASE="$2"
                DOCKER_IMAGE="debian:$2"
                shift 2
                ;;
            -o|--output)
                OUTPUT_DIR="$2"
                shift 2
                ;;
            -f|--format)
                FORMAT="$2"
                shift 2
                ;;
            -p|--password)
                ROOT_PASSWORD="$2"
                shift 2
                ;;
            -K|--ssh-key)
                SSH_KEY="$2"
                shift 2
                ;;
            -P|--packages)
                EXTRA_PACKAGES="$2"
                shift 2
                ;;
            -H|--hostname)
                HOSTNAME="$2"
                shift 2
                ;;
            -h|--help)
                usage
                ;;
            *)
                echo -e "${RED}Unknown option: $1${NC}"
                usage
                ;;
        esac
    done
}

check_deps_macos() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: Docker is required on macOS${NC}"
        echo "Install Docker Desktop: https://www.docker.com/products/docker-desktop"
        exit 1
    fi
    if ! docker info &> /dev/null; then
        echo -e "${RED}Error: Docker daemon is not running${NC}"
        exit 1
    fi
}

check_deps_linux() {
    local missing=()
    for cmd in debootstrap qemu-img mount parted; do
        if ! command -v $cmd &> /dev/null; then
            missing+=($cmd)
        fi
    done
    if [ ${#missing[@]} -gt 0 ]; then
        echo -e "${RED}Error: Missing required commands: ${missing[*]}${NC}"
        echo "Install with: sudo apt install debootstrap qemu-utils parted"
        exit 1
    fi
    if [ "$(id -u)" -ne 0 ]; then
        echo -e "${RED}Error: Must run as root on Linux (need mount/losetup permissions)${NC}"
        echo "Run with: sudo $0 $*"
        exit 1
    fi
}

generate_password() {
    if command -v openssl &> /dev/null; then
        openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c 12
    else
        head -c 12 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 12
    fi
}

build_image_linux() {
    local image_path="$1"
    local raw_path="${image_path%.qcow2}.raw"
    local mount_point="/tmp/qemu-rootfs-$$"
    local loop_device=""

    # Convert size to bytes for raw image
    local size_bytes
    case "${IMAGE_SIZE: -1}" in
        G|g) size_bytes=$(( ${IMAGE_SIZE%?} * 1024 * 1024 * 1024 )) ;;
        M|m) size_bytes=$(( ${IMAGE_SIZE%?} * 1024 * 1024 )) ;;
        *) size_bytes=$IMAGE_SIZE ;;
    esac
    local size_mb=$(( size_bytes / 1024 / 1024 ))

    echo -e "${GREEN}Creating ${IMAGE_SIZE} raw image...${NC}"
    dd if=/dev/zero of="$raw_path" bs=1M count="$size_mb" status=progress

    echo -e "${GREEN}Partitioning image...${NC}"
    parted -s "$raw_path" mklabel msdos
    parted -s "$raw_path" mkpart primary ext4 1MiB 100%
    parted -s "$raw_path" set 1 boot on

    echo -e "${GREEN}Setting up loop device...${NC}"
    loop_device=$(losetup -f --show -P "$raw_path")

    # Cleanup on exit
    cleanup() {
        echo "Cleaning up..."
        umount "$mount_point" 2>/dev/null || true
        losetup -d "$loop_device" 2>/dev/null || true
        rmdir "$mount_point" 2>/dev/null || true
    }
    trap cleanup EXIT

    echo -e "${GREEN}Creating ext4 filesystem...${NC}"
    mkfs.ext4 -F "${loop_device}p1"

    echo -e "${GREEN}Mounting image...${NC}"
    mkdir -p "$mount_point"
    mount "${loop_device}p1" "$mount_point"

    echo -e "${GREEN}Running debootstrap ($DEBIAN_RELEASE)...${NC}"
    local all_packages="$PACKAGES"
    if [ -n "$EXTRA_PACKAGES" ]; then
        all_packages="$all_packages,$EXTRA_PACKAGES"
    fi
    debootstrap --include="$all_packages" "$DEBIAN_RELEASE" "$mount_point" http://deb.debian.org/debian

    configure_rootfs "$mount_point"
    install_grub "$mount_point" "$loop_device"

    echo -e "${GREEN}Unmounting...${NC}"
    umount "$mount_point"
    losetup -d "$loop_device"
    rmdir "$mount_point"
    trap - EXIT

    # Convert to qcow2 if requested
    if [ "$FORMAT" = "qcow2" ]; then
        echo -e "${GREEN}Converting to qcow2...${NC}"
        qemu-img convert -f raw -O qcow2 "$raw_path" "$image_path"
        rm -f "$raw_path"
    else
        mv "$raw_path" "$image_path"
    fi
}

build_image_docker() {
    local image_path="$1"
    local build_dir="/tmp/qemu-build-$$"

    mkdir -p "$build_dir"

    # Generate the in-container build script
    # Uses supermin/guestfish approach to avoid losetup issues in Docker on macOS
    cat > "$build_dir/build-in-docker.sh" << 'DOCKERSCRIPT'
#!/bin/bash
set -e

IMAGE_PATH="$1"
IMAGE_SIZE="$2"
DEBIAN_RELEASE="$3"
PACKAGES="$4"
ROOT_PASSWORD="$5"
SSH_KEY="$6"
HOSTNAME="$7"
FORMAT="$8"

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y debootstrap qemu-utils e2fsprogs grub-pc-bin dosfstools fdisk

# Convert size to MB
case "${IMAGE_SIZE: -1}" in
    G|g) SIZE_MB=$(( ${IMAGE_SIZE%?} * 1024 )) ;;
    M|m) SIZE_MB=${IMAGE_SIZE%?} ;;
    *) SIZE_MB=$IMAGE_SIZE ;;
esac

# Reserve space: 1MB for MBR, rest for rootfs
ROOTFS_MB=$(( SIZE_MB - 2 ))

ROOTFS_IMG="/tmp/rootfs.ext4"
RAW_PATH="${IMAGE_PATH%.qcow2}.raw"

echo "Creating ${ROOTFS_MB}MB ext4 rootfs..."
dd if=/dev/zero of="$ROOTFS_IMG" bs=1M count="$ROOTFS_MB" status=progress
mkfs.ext4 -F "$ROOTFS_IMG"

echo "Mounting rootfs..."
mkdir -p /mnt/rootfs
mount -o loop "$ROOTFS_IMG" /mnt/rootfs

echo "Running debootstrap ($DEBIAN_RELEASE)..."
debootstrap --include="$PACKAGES" "$DEBIAN_RELEASE" /mnt/rootfs http://deb.debian.org/debian

MOUNT_POINT="/mnt/rootfs"

# Configure the rootfs
echo "Configuring rootfs..."

# Set hostname
echo "$HOSTNAME" > "$MOUNT_POINT/etc/hostname"
cat > "$MOUNT_POINT/etc/hosts" << EOF
127.0.0.1   localhost
127.0.1.1   $HOSTNAME
::1         localhost ip6-localhost ip6-loopback
EOF

# Set root password
echo "root:$ROOT_PASSWORD" | chroot "$MOUNT_POINT" chpasswd

# Configure SSH
mkdir -p "$MOUNT_POINT/root/.ssh"
chmod 700 "$MOUNT_POINT/root/.ssh"
if [ -n "$SSH_KEY" ]; then
    echo "$SSH_KEY" > "$MOUNT_POINT/root/.ssh/authorized_keys"
    chmod 600 "$MOUNT_POINT/root/.ssh/authorized_keys"
fi

# Allow root SSH login
sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' "$MOUNT_POINT/etc/ssh/sshd_config" 2>/dev/null || true
sed -i 's/PermitRootLogin.*/PermitRootLogin yes/' "$MOUNT_POINT/etc/ssh/sshd_config" 2>/dev/null || true

# Configure fstab
cat > "$MOUNT_POINT/etc/fstab" << EOF
# <file system> <mount point>   <type>  <options>       <dump>  <pass>
/dev/sda1       /               ext4    errors=remount-ro 0       1
EOF

# Configure network (DHCP on all interfaces)
cat > "$MOUNT_POINT/etc/network/interfaces" << EOF
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp

# Also try ens3 (virtio naming)
auto ens3
iface ens3 inet dhcp
EOF

# Enable serial console
mkdir -p "$MOUNT_POINT/etc/systemd/system/serial-getty@ttyS0.service.d"
cat > "$MOUNT_POINT/etc/systemd/system/serial-getty@ttyS0.service.d/override.conf" << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root -o '-p -- \\u' --keep-baud 115200,57600,38400,9600 %I \$TERM
EOF
chroot "$MOUNT_POINT" systemctl enable serial-getty@ttyS0.service 2>/dev/null || true

# Set timezone
chroot "$MOUNT_POINT" ln -sf /usr/share/zoneinfo/UTC /etc/localtime

# Get kernel version for grub config
KERNEL_VERSION=$(ls "$MOUNT_POINT/boot/" | grep "vmlinuz-" | head -1 | sed 's/vmlinuz-//')

# Create grub config (grub-install will be done on the final image)
mkdir -p "$MOUNT_POINT/boot/grub"
cat > "$MOUNT_POINT/boot/grub/grub.cfg" << EOF
set timeout=1
set default=0

menuentry "Debian GNU/Linux" {
    linux /boot/vmlinuz-${KERNEL_VERSION} root=/dev/sda1 ro console=tty0 console=ttyS0,115200n8
    initrd /boot/initrd.img-${KERNEL_VERSION}
}
EOF

# Clean up
chroot "$MOUNT_POINT" apt-get clean
rm -rf "$MOUNT_POINT/var/lib/apt/lists/"*
rm -rf "$MOUNT_POINT/var/cache/apt/"*

echo "Unmounting rootfs..."
umount /mnt/rootfs

echo "Creating partitioned disk image..."
# Create the final raw image with MBR
dd if=/dev/zero of="$RAW_PATH" bs=1M count="$SIZE_MB" status=progress

# Write MBR partition table using sfdisk
echo ",,L,*" | sfdisk "$RAW_PATH"

# Copy rootfs into partition (starting at 1MB = 2048 sectors)
dd if="$ROOTFS_IMG" of="$RAW_PATH" bs=512 seek=2048 conv=notrunc status=progress

# Install GRUB MBR
echo "Installing GRUB to MBR..."
grub-install --target=i386-pc --boot-directory=/tmp/grub-boot --modules="part_msdos ext2" "$RAW_PATH" 2>/dev/null || true

# If grub-install failed, manually write grub boot sector
if [ ! -f /tmp/grub-boot/grub/i386-pc/core.img ]; then
    echo "Using fallback GRUB installation..."
    mkdir -p /tmp/grub-boot/grub/i386-pc
    # Copy GRUB modules
    cp -r /usr/lib/grub/i386-pc/* /tmp/grub-boot/grub/i386-pc/ 2>/dev/null || true
    # Create core image
    grub-mkimage -O i386-pc -o /tmp/core.img -p "(hd0,msdos1)/boot/grub" part_msdos ext2 biosdisk || true
    # Write boot.img to MBR
    if [ -f /usr/lib/grub/i386-pc/boot.img ]; then
        dd if=/usr/lib/grub/i386-pc/boot.img of="$RAW_PATH" bs=446 count=1 conv=notrunc
    fi
    # Write core.img after MBR
    if [ -f /tmp/core.img ]; then
        dd if=/tmp/core.img of="$RAW_PATH" bs=512 seek=1 conv=notrunc
    fi
fi

rm -f "$ROOTFS_IMG"

# Convert to qcow2 if requested
if [ "$FORMAT" = "qcow2" ]; then
    echo "Converting to qcow2..."
    qemu-img convert -f raw -O qcow2 "$RAW_PATH" "$IMAGE_PATH"
    rm -f "$RAW_PATH"
else
    mv "$RAW_PATH" "$IMAGE_PATH"
fi

echo "Done!"
DOCKERSCRIPT

    chmod +x "$build_dir/build-in-docker.sh"

    # Prepare packages list
    local all_packages="$PACKAGES"
    if [ -n "$EXTRA_PACKAGES" ]; then
        all_packages="$all_packages,$EXTRA_PACKAGES"
    fi

    echo -e "${GREEN}Building image in Docker container (x86_64)...${NC}"
    docker run --rm --privileged \
        --platform linux/amd64 \
        -v "$build_dir:/build" \
        -v "$(dirname "$image_path"):/output" \
        "$DOCKER_IMAGE" \
        /build/build-in-docker.sh \
        "/output/$(basename "$image_path")" \
        "$IMAGE_SIZE" \
        "$DEBIAN_RELEASE" \
        "$all_packages" \
        "$ROOT_PASSWORD" \
        "$SSH_KEY" \
        "$HOSTNAME" \
        "$FORMAT"

    rm -rf "$build_dir"
}

configure_rootfs() {
    local mount_point="$1"

    echo -e "${GREEN}Configuring rootfs...${NC}"

    # Set hostname
    echo "$HOSTNAME" > "$mount_point/etc/hostname"
    cat > "$mount_point/etc/hosts" << EOF
127.0.0.1   localhost
127.0.1.1   $HOSTNAME
::1         localhost ip6-localhost ip6-loopback
EOF

    # Set root password
    echo "root:$ROOT_PASSWORD" | chroot "$mount_point" chpasswd

    # Configure SSH
    mkdir -p "$mount_point/root/.ssh"
    chmod 700 "$mount_point/root/.ssh"
    if [ -n "$SSH_KEY" ]; then
        echo "$SSH_KEY" > "$mount_point/root/.ssh/authorized_keys"
        chmod 600 "$mount_point/root/.ssh/authorized_keys"
    fi

    # Allow root SSH login
    sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' "$mount_point/etc/ssh/sshd_config" 2>/dev/null || true
    sed -i 's/PermitRootLogin.*/PermitRootLogin yes/' "$mount_point/etc/ssh/sshd_config" 2>/dev/null || true

    # Configure fstab
    cat > "$mount_point/etc/fstab" << EOF
# <file system> <mount point>   <type>  <options>       <dump>  <pass>
/dev/sda1       /               ext4    errors=remount-ro 0       1
EOF

    # Configure network (DHCP)
    cat > "$mount_point/etc/network/interfaces" << EOF
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp

auto ens3
iface ens3 inet dhcp
EOF

    # Enable serial console
    mkdir -p "$mount_point/etc/systemd/system/serial-getty@ttyS0.service.d"
    cat > "$mount_point/etc/systemd/system/serial-getty@ttyS0.service.d/override.conf" << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root -o '-p -- \\u' --keep-baud 115200,57600,38400,9600 %I \$TERM
EOF
    chroot "$mount_point" systemctl enable serial-getty@ttyS0.service 2>/dev/null || true

    # Set timezone
    chroot "$mount_point" ln -sf /usr/share/zoneinfo/UTC /etc/localtime

    # Clean up
    chroot "$mount_point" apt-get clean
    rm -rf "$mount_point/var/lib/apt/lists/"*
    rm -rf "$mount_point/var/cache/apt/"*
}

install_grub() {
    local mount_point="$1"
    local loop_device="$2"

    echo -e "${GREEN}Installing GRUB...${NC}"

    mount --bind /dev "$mount_point/dev"
    mount --bind /proc "$mount_point/proc"
    mount --bind /sys "$mount_point/sys"

    # Get loop device without partition suffix
    local grub_device="${loop_device%p1}"
    [ "$grub_device" = "$loop_device" ] && grub_device="$loop_device"

    chroot "$mount_point" grub-install --target=i386-pc --boot-directory=/boot "$grub_device" || true

    # Create grub config
    local kernel_version=$(ls "$mount_point/boot/" | grep "vmlinuz-" | head -1 | sed 's/vmlinuz-//')
    cat > "$mount_point/boot/grub/grub.cfg" << EOF
set timeout=1
set default=0

menuentry "Debian GNU/Linux" {
    linux /boot/vmlinuz-${kernel_version} root=/dev/sda1 ro console=tty0 console=ttyS0,115200n8
    initrd /boot/initrd.img-${kernel_version}
}
EOF

    umount "$mount_point/sys"
    umount "$mount_point/proc"
    umount "$mount_point/dev"
}

# ============================================================================
# TUI Mode Functions
# ============================================================================

run_tui_mode() {
    tui_setup_cleanup
    tui_wizard_start

    # Welcome screen
    tui_welcome_screen \
        "QEMU Image Builder" \
        "Build bootable VM images for QEMU/KVM" \
        "$PLATFORM"

    local total_steps=5
    local current_step=1

    # Step 1: Basic settings
    tui_clear
    tui_wizard_step $current_step $total_steps "Basic Settings"

    tui_input "Image name" "$IMAGE_NAME"
    IMAGE_NAME="$TUI_RESULT"

    tui_input "Hostname" "$HOSTNAME"
    HOSTNAME="$TUI_RESULT"

    ((current_step++))

    # Step 2: Disk settings
    tui_clear
    tui_wizard_step $current_step $total_steps "Disk Settings"

    local sizes=("8G (Recommended)" "4G (Minimal)" "16G (Large)" "32G (Extra Large)")
    tui_radiolist "Select disk size:" "${sizes[@]}"
    case $TUI_RESULT in
        0) IMAGE_SIZE="8G" ;;
        1) IMAGE_SIZE="4G" ;;
        2) IMAGE_SIZE="16G" ;;
        3) IMAGE_SIZE="32G" ;;
    esac

    printf '\n'
    local formats=("qcow2 (Recommended, supports snapshots)" "raw (Maximum performance)")
    tui_radiolist "Select image format:" "${formats[@]}"
    case $TUI_RESULT in
        0) FORMAT="qcow2" ;;
        1) FORMAT="raw" ;;
    esac

    ((current_step++))

    # Step 3: Debian release
    tui_clear
    tui_wizard_step $current_step $total_steps "Debian Release"

    local releases=("bookworm (Debian 12, Recommended)" "bullseye (Debian 11)" "trixie (Debian 13, Testing)")
    tui_radiolist "Select Debian release:" "${releases[@]}"
    case $TUI_RESULT in
        0) DEBIAN_RELEASE="bookworm" ;;
        1) DEBIAN_RELEASE="bullseye" ;;
        2) DEBIAN_RELEASE="trixie" ;;
    esac
    DOCKER_IMAGE="debian:$DEBIAN_RELEASE"

    ((current_step++))

    # Step 4: Packages & Auth
    tui_clear
    tui_wizard_step $current_step $total_steps "Packages & Authentication"

    printf 'Base packages: %s\n\n' "$PACKAGES"
    tui_input "Extra packages (comma-separated, or empty)" "$EXTRA_PACKAGES"
    EXTRA_PACKAGES="$TUI_RESULT"

    printf '\nRoot password (leave empty for random):\n'
    tui_password "Password"
    ROOT_PASSWORD="$TUI_RESULT"

    printf '\n'
    tui_input "SSH public key (optional)" "$SSH_KEY"
    SSH_KEY="$TUI_RESULT"

    ((current_step++))

    # Step 5: Summary & Confirm
    while true; do
        tui_clear
        tui_wizard_step $current_step $total_steps "Summary"

        printf '\n'
        tui_summary \
            "Image name|$IMAGE_NAME" \
            "Hostname|$HOSTNAME" \
            "Size|$IMAGE_SIZE" \
            "Format|$FORMAT" \
            "Debian|$DEBIAN_RELEASE" \
            "Extra packages|${EXTRA_PACKAGES:-none}" \
            "SSH key|$( [ -n "$SSH_KEY" ] && echo 'configured' || echo 'none' )" \
            "Output|$OUTPUT_DIR"

        printf '\n\n'
        tui_buttons "Build" "Edit" "Cancel"

        case $TUI_RESULT in
            0)  # Build
                break
                ;;
            1)  # Edit - restart from step 1
                current_step=1
                tui_clear
                tui_wizard_step $current_step $total_steps "Basic Settings"
                tui_input "Image name" "$IMAGE_NAME"
                IMAGE_NAME="$TUI_RESULT"
                tui_input "Hostname" "$HOSTNAME"
                HOSTNAME="$TUI_RESULT"
                current_step=$total_steps
                ;;
            2)  # Cancel
                tui_wizard_finish
                echo "Build cancelled."
                exit 0
                ;;
        esac
    done

    tui_wizard_finish

    # Proceed with build
    run_build
}

run_build() {
    # Check dependencies
    if $IS_MACOS; then
        check_deps_macos
    elif $IS_LINUX; then
        check_deps_linux
    else
        echo -e "${RED}Unsupported platform: $PLATFORM${NC}"
        exit 1
    fi

    # Generate password if not provided
    if [ -z "$ROOT_PASSWORD" ]; then
        ROOT_PASSWORD=$(generate_password)
    fi

    # Create output directory
    mkdir -p "$OUTPUT_DIR"
    OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"

    local image_ext="$FORMAT"
    local image_path="$OUTPUT_DIR/${IMAGE_NAME}.${image_ext}"

    echo -e "${GREEN}=== QEMU Image Builder ===${NC}"
    echo "Platform:     $PLATFORM"
    echo "Image name:   $IMAGE_NAME"
    echo "Image size:   $IMAGE_SIZE"
    echo "Format:       $FORMAT"
    echo "Debian:       $DEBIAN_RELEASE"
    echo "Hostname:     $HOSTNAME"
    echo "Output dir:   $OUTPUT_DIR"
    echo ""

    # Build image
    if $IS_MACOS; then
        build_image_docker "$image_path"
    else
        build_image_linux "$image_path"
    fi

    echo ""
    echo -e "${GREEN}=== Build Complete ===${NC}"
    echo "Image: $image_path ($(du -h "$image_path" | cut -f1))"
    echo ""
    echo -e "${YELLOW}Root password: $ROOT_PASSWORD${NC}"
    if [ -n "$SSH_KEY" ]; then
        echo "SSH key installed to /root/.ssh/authorized_keys"
    fi
    echo ""
    echo "To use with vm-provisioner, the image is already in the images directory."
    echo ""
    echo "Manual QEMU test:"
    echo "  qemu-system-x86_64 -m 512 -drive file=$image_path,format=$FORMAT -nographic"
}

main() {
    if $INTERACTIVE_MODE; then
        if ! $TUI_AVAILABLE; then
            echo -e "${RED}Error: TUI library not found at $SCRIPT_DIR/../lib/tui.sh${NC}"
            exit 1
        fi
        run_tui_mode
    else
        parse_args "$@"
        run_build
    fi
}

main "$@"
