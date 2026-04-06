#!/bin/bash

# build-iso.sh - Build bootable Linux ISO images
# Works on both macOS (via Docker) and Linux (native)
#
# Usage: ./build-iso.sh [options]
#        ./build-iso.sh              # Launch interactive TUI (if terminal)
#        ./build-iso.sh -i           # Force interactive TUI mode
#
# Produces:
#   - <name>.iso: Bootable Linux ISO image

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
IMAGE_NAME="linux-live"
DEBIAN_RELEASE="bookworm"
OUTPUT_DIR="../vm-provisioner/images"
ROOT_PASSWORD=""
SSH_KEY=""
PACKAGES="openssh-server,sudo,curl,ca-certificates,systemd-sysv,live-boot,linux-image-amd64"
EXTRA_PACKAGES=""
HOSTNAME="linux-live"
DOCKER_IMAGE="debian:bookworm"
ISO_TYPE="live"
ISO_LABEL="LINUX_LIVE"

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

Build bootable Linux ISO images on macOS or Linux.

Options:
  -i, --interactive       Launch interactive TUI mode
  -n, --name NAME         ISO name (default: linux-live)
  -t, --type TYPE         ISO type: live, installer (default: live)
  -r, --release RELEASE   Debian release: bullseye, bookworm, trixie (default: bookworm)
  -o, --output DIR        Output directory (default: ../vm-provisioner/images)
  -p, --password PASS     Root password (default: random, printed at end)
  -K, --ssh-key KEY       SSH public key to add to root's authorized_keys
  -P, --packages PKGS     Extra packages to install (comma-separated)
  -H, --hostname NAME     Default hostname (default: linux-live)
  -l, --label LABEL       ISO volume label (default: LINUX_LIVE)
  -h, --help              Show this help

Note: Running without arguments in a terminal launches interactive TUI mode.

ISO Types:
  live       - Boot directly into a live system (RAM-based)
  installer  - Debian installer ISO with preseed support

Examples:
  $0                                    # Build live ISO with defaults
  $0 -n rescue -t live -P "vim,htop"    # Live rescue ISO with extra tools
  $0 -t installer -n debian-auto        # Installer ISO

Platform: $PLATFORM
$(if $IS_MACOS; then echo "  macOS detected - will use Docker for ISO building"; fi)

Output files:
  <output>/<name>.iso    - Bootable ISO image
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
            -t|--type)
                ISO_TYPE="$2"
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
            -l|--label)
                ISO_LABEL="$2"
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
    for cmd in debootstrap xorriso mksquashfs; do
        if ! command -v $cmd &> /dev/null; then
            missing+=($cmd)
        fi
    done
    if [ ${#missing[@]} -gt 0 ]; then
        echo -e "${RED}Error: Missing required commands: ${missing[*]}${NC}"
        echo "Install with: sudo apt install debootstrap xorriso squashfs-tools grub-pc-bin grub-efi-amd64-bin"
        exit 1
    fi
    if [ "$(id -u)" -ne 0 ]; then
        echo -e "${RED}Error: Must run as root on Linux${NC}"
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

build_iso_docker() {
    local iso_path="$1"
    local build_dir="/tmp/iso-build-$$"

    mkdir -p "$build_dir"

    # Generate the in-container build script
    cat > "$build_dir/build-in-docker.sh" << 'DOCKERSCRIPT'
#!/bin/bash
set -e

ISO_PATH="$1"
DEBIAN_RELEASE="$2"
PACKAGES="$3"
ROOT_PASSWORD="$4"
SSH_KEY="$5"
HOSTNAME="$6"
ISO_TYPE="$7"
ISO_LABEL="$8"

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y debootstrap xorriso squashfs-tools grub-pc-bin grub-efi-amd64-bin \
    mtools dosfstools isolinux syslinux-common

WORK_DIR="/tmp/iso-work"
CHROOT_DIR="$WORK_DIR/chroot"
ISO_DIR="$WORK_DIR/iso"

mkdir -p "$CHROOT_DIR" "$ISO_DIR"/{boot/grub,isolinux,live,EFI/boot}

echo "Running debootstrap ($DEBIAN_RELEASE)..."
debootstrap --include="$PACKAGES" "$DEBIAN_RELEASE" "$CHROOT_DIR" http://deb.debian.org/debian

# Configure the system
echo "Configuring system..."

# Set hostname
echo "$HOSTNAME" > "$CHROOT_DIR/etc/hostname"
cat > "$CHROOT_DIR/etc/hosts" << EOF
127.0.0.1   localhost
127.0.1.1   $HOSTNAME
::1         localhost ip6-localhost ip6-loopback
EOF

# Set root password
echo "root:$ROOT_PASSWORD" | chroot "$CHROOT_DIR" chpasswd

# Configure SSH
mkdir -p "$CHROOT_DIR/root/.ssh"
chmod 700 "$CHROOT_DIR/root/.ssh"
if [ -n "$SSH_KEY" ]; then
    echo "$SSH_KEY" > "$CHROOT_DIR/root/.ssh/authorized_keys"
    chmod 600 "$CHROOT_DIR/root/.ssh/authorized_keys"
fi

# Allow root SSH login
sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' "$CHROOT_DIR/etc/ssh/sshd_config" 2>/dev/null || true
sed -i 's/PermitRootLogin.*/PermitRootLogin yes/' "$CHROOT_DIR/etc/ssh/sshd_config" 2>/dev/null || true

# Configure network (DHCP)
cat > "$CHROOT_DIR/etc/network/interfaces" << EOF
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp
EOF

# Enable serial console
mkdir -p "$CHROOT_DIR/etc/systemd/system/serial-getty@ttyS0.service.d"
cat > "$CHROOT_DIR/etc/systemd/system/serial-getty@ttyS0.service.d/override.conf" << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root -o '-p -- \\u' --keep-baud 115200,57600,38400,9600 %I \$TERM
EOF
chroot "$CHROOT_DIR" systemctl enable serial-getty@ttyS0.service 2>/dev/null || true

# Set timezone
chroot "$CHROOT_DIR" ln -sf /usr/share/zoneinfo/UTC /etc/localtime

# Clean up
chroot "$CHROOT_DIR" apt-get clean
rm -rf "$CHROOT_DIR/var/lib/apt/lists/"*
rm -rf "$CHROOT_DIR/var/cache/apt/"*
rm -rf "$CHROOT_DIR/tmp/"*

# Get kernel and initrd
KERNEL_VERSION=$(ls "$CHROOT_DIR/boot/" | grep "vmlinuz-" | head -1 | sed 's/vmlinuz-//')
cp "$CHROOT_DIR/boot/vmlinuz-$KERNEL_VERSION" "$ISO_DIR/live/vmlinuz"
cp "$CHROOT_DIR/boot/initrd.img-$KERNEL_VERSION" "$ISO_DIR/live/initrd.img"

echo "Creating squashfs..."
mksquashfs "$CHROOT_DIR" "$ISO_DIR/live/filesystem.squashfs" -comp xz -e boot

# Create ISOLINUX config (BIOS boot)
cp /usr/lib/ISOLINUX/isolinux.bin "$ISO_DIR/isolinux/"
cp /usr/lib/syslinux/modules/bios/{ldlinux.c32,libcom32.c32,libutil.c32,vesamenu.c32} "$ISO_DIR/isolinux/"

cat > "$ISO_DIR/isolinux/isolinux.cfg" << EOF
UI vesamenu.c32
TIMEOUT 50
PROMPT 0
DEFAULT live

LABEL live
    MENU LABEL ^Start $HOSTNAME Live
    KERNEL /live/vmlinuz
    APPEND initrd=/live/initrd.img boot=live components quiet splash

LABEL live-serial
    MENU LABEL Start $HOSTNAME Live (^Serial Console)
    KERNEL /live/vmlinuz
    APPEND initrd=/live/initrd.img boot=live components console=ttyS0,115200n8
EOF

# Create GRUB config (EFI boot)
cat > "$ISO_DIR/boot/grub/grub.cfg" << EOF
set timeout=5
set default=0

menuentry "Start $HOSTNAME Live" {
    linux /live/vmlinuz boot=live components quiet splash
    initrd /live/initrd.img
}

menuentry "Start $HOSTNAME Live (Serial Console)" {
    linux /live/vmlinuz boot=live components console=ttyS0,115200n8
    initrd /live/initrd.img
}
EOF

# Create EFI boot image
grub-mkstandalone \
    --format=x86_64-efi \
    --output="$ISO_DIR/EFI/boot/bootx64.efi" \
    --locales="" \
    --fonts="" \
    "boot/grub/grub.cfg=$ISO_DIR/boot/grub/grub.cfg"

# Create FAT EFI partition image
dd if=/dev/zero of="$ISO_DIR/boot/efi.img" bs=1M count=4
mkfs.vfat "$ISO_DIR/boot/efi.img"
mmd -i "$ISO_DIR/boot/efi.img" ::/EFI ::/EFI/boot
mcopy -i "$ISO_DIR/boot/efi.img" "$ISO_DIR/EFI/boot/bootx64.efi" ::/EFI/boot/

echo "Creating ISO..."
xorriso -as mkisofs \
    -iso-level 3 \
    -full-iso9660-filenames \
    -volid "$ISO_LABEL" \
    -eltorito-boot isolinux/isolinux.bin \
    -eltorito-catalog isolinux/boot.cat \
    -no-emul-boot \
    -boot-load-size 4 \
    -boot-info-table \
    -isohybrid-mbr /usr/lib/ISOLINUX/isohdpfx.bin \
    -eltorito-alt-boot \
    -e boot/efi.img \
    -no-emul-boot \
    -isohybrid-gpt-basdat \
    -output "$ISO_PATH" \
    "$ISO_DIR"

# Clean up
rm -rf "$WORK_DIR"

echo "Done!"
DOCKERSCRIPT

    chmod +x "$build_dir/build-in-docker.sh"

    # Prepare packages list
    local all_packages="$PACKAGES"
    if [ -n "$EXTRA_PACKAGES" ]; then
        all_packages="$all_packages,$EXTRA_PACKAGES"
    fi

    echo -e "${GREEN}Building ISO in Docker container (x86_64)...${NC}"
    docker run --rm --privileged \
        --platform linux/amd64 \
        -v "$build_dir:/build" \
        -v "$(dirname "$iso_path"):/output" \
        "$DOCKER_IMAGE" \
        /build/build-in-docker.sh \
        "/output/$(basename "$iso_path")" \
        "$DEBIAN_RELEASE" \
        "$all_packages" \
        "$ROOT_PASSWORD" \
        "$SSH_KEY" \
        "$HOSTNAME" \
        "$ISO_TYPE" \
        "$ISO_LABEL"

    rm -rf "$build_dir"
}

build_iso_linux() {
    local iso_path="$1"
    local work_dir="/tmp/iso-work-$$"
    local chroot_dir="$work_dir/chroot"
    local iso_dir="$work_dir/iso"

    mkdir -p "$chroot_dir" "$iso_dir"/{boot/grub,isolinux,live,EFI/boot}

    # Cleanup on exit
    cleanup() {
        echo "Cleaning up..."
        rm -rf "$work_dir"
    }
    trap cleanup EXIT

    echo -e "${GREEN}Running debootstrap ($DEBIAN_RELEASE)...${NC}"
    local all_packages="$PACKAGES"
    if [ -n "$EXTRA_PACKAGES" ]; then
        all_packages="$all_packages,$EXTRA_PACKAGES"
    fi
    debootstrap --include="$all_packages" "$DEBIAN_RELEASE" "$chroot_dir" http://deb.debian.org/debian

    configure_chroot "$chroot_dir"

    # Get kernel and initrd
    local kernel_version=$(ls "$chroot_dir/boot/" | grep "vmlinuz-" | head -1 | sed 's/vmlinuz-//')
    cp "$chroot_dir/boot/vmlinuz-$kernel_version" "$iso_dir/live/vmlinuz"
    cp "$chroot_dir/boot/initrd.img-$kernel_version" "$iso_dir/live/initrd.img"

    echo -e "${GREEN}Creating squashfs...${NC}"
    mksquashfs "$chroot_dir" "$iso_dir/live/filesystem.squashfs" -comp xz -e boot

    create_bootloaders "$iso_dir"

    echo -e "${GREEN}Creating ISO...${NC}"
    xorriso -as mkisofs \
        -iso-level 3 \
        -full-iso9660-filenames \
        -volid "$ISO_LABEL" \
        -eltorito-boot isolinux/isolinux.bin \
        -eltorito-catalog isolinux/boot.cat \
        -no-emul-boot \
        -boot-load-size 4 \
        -boot-info-table \
        -isohybrid-mbr /usr/lib/ISOLINUX/isohdpfx.bin \
        -eltorito-alt-boot \
        -e boot/efi.img \
        -no-emul-boot \
        -isohybrid-gpt-basdat \
        -output "$iso_path" \
        "$iso_dir"

    trap - EXIT
    rm -rf "$work_dir"
}

configure_chroot() {
    local chroot_dir="$1"

    echo -e "${GREEN}Configuring system...${NC}"

    # Set hostname
    echo "$HOSTNAME" > "$chroot_dir/etc/hostname"
    cat > "$chroot_dir/etc/hosts" << EOF
127.0.0.1   localhost
127.0.1.1   $HOSTNAME
::1         localhost ip6-localhost ip6-loopback
EOF

    # Set root password
    echo "root:$ROOT_PASSWORD" | chroot "$chroot_dir" chpasswd

    # Configure SSH
    mkdir -p "$chroot_dir/root/.ssh"
    chmod 700 "$chroot_dir/root/.ssh"
    if [ -n "$SSH_KEY" ]; then
        echo "$SSH_KEY" > "$chroot_dir/root/.ssh/authorized_keys"
        chmod 600 "$chroot_dir/root/.ssh/authorized_keys"
    fi

    # Allow root SSH login
    sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' "$chroot_dir/etc/ssh/sshd_config" 2>/dev/null || true
    sed -i 's/PermitRootLogin.*/PermitRootLogin yes/' "$chroot_dir/etc/ssh/sshd_config" 2>/dev/null || true

    # Configure network
    cat > "$chroot_dir/etc/network/interfaces" << EOF
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp
EOF

    # Enable serial console
    mkdir -p "$chroot_dir/etc/systemd/system/serial-getty@ttyS0.service.d"
    cat > "$chroot_dir/etc/systemd/system/serial-getty@ttyS0.service.d/override.conf" << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root -o '-p -- \\u' --keep-baud 115200,57600,38400,9600 %I \$TERM
EOF
    chroot "$chroot_dir" systemctl enable serial-getty@ttyS0.service 2>/dev/null || true

    # Set timezone
    chroot "$chroot_dir" ln -sf /usr/share/zoneinfo/UTC /etc/localtime

    # Clean up
    chroot "$chroot_dir" apt-get clean
    rm -rf "$chroot_dir/var/lib/apt/lists/"*
    rm -rf "$chroot_dir/var/cache/apt/"*
    rm -rf "$chroot_dir/tmp/"*
}

create_bootloaders() {
    local iso_dir="$1"

    # ISOLINUX (BIOS)
    cp /usr/lib/ISOLINUX/isolinux.bin "$iso_dir/isolinux/"
    cp /usr/lib/syslinux/modules/bios/{ldlinux.c32,libcom32.c32,libutil.c32,vesamenu.c32} "$iso_dir/isolinux/"

    cat > "$iso_dir/isolinux/isolinux.cfg" << EOF
UI vesamenu.c32
TIMEOUT 50
PROMPT 0
DEFAULT live

LABEL live
    MENU LABEL ^Start $HOSTNAME Live
    KERNEL /live/vmlinuz
    APPEND initrd=/live/initrd.img boot=live components quiet splash

LABEL live-serial
    MENU LABEL Start $HOSTNAME Live (^Serial Console)
    KERNEL /live/vmlinuz
    APPEND initrd=/live/initrd.img boot=live components console=ttyS0,115200n8
EOF

    # GRUB (EFI)
    cat > "$iso_dir/boot/grub/grub.cfg" << EOF
set timeout=5
set default=0

menuentry "Start $HOSTNAME Live" {
    linux /live/vmlinuz boot=live components quiet splash
    initrd /live/initrd.img
}

menuentry "Start $HOSTNAME Live (Serial Console)" {
    linux /live/vmlinuz boot=live components console=ttyS0,115200n8
    initrd /live/initrd.img
}
EOF

    # Create EFI boot image
    grub-mkstandalone \
        --format=x86_64-efi \
        --output="$iso_dir/EFI/boot/bootx64.efi" \
        --locales="" \
        --fonts="" \
        "boot/grub/grub.cfg=$iso_dir/boot/grub/grub.cfg"

    # Create FAT EFI partition
    dd if=/dev/zero of="$iso_dir/boot/efi.img" bs=1M count=4
    mkfs.vfat "$iso_dir/boot/efi.img"
    mmd -i "$iso_dir/boot/efi.img" ::/EFI ::/EFI/boot
    mcopy -i "$iso_dir/boot/efi.img" "$iso_dir/EFI/boot/bootx64.efi" ::/EFI/boot/
}

# ============================================================================
# TUI Mode Functions
# ============================================================================

run_tui_mode() {
    tui_setup_cleanup
    tui_wizard_start

    # Welcome screen
    tui_welcome_screen \
        "Linux ISO Builder" \
        "Build bootable live/installer ISO images" \
        "$PLATFORM"

    local total_steps=5
    local current_step=1

    # Step 1: Basic settings
    tui_clear
    tui_wizard_step $current_step $total_steps "Basic Settings"

    tui_input "ISO name" "$IMAGE_NAME"
    IMAGE_NAME="$TUI_RESULT"

    tui_input "Hostname" "$HOSTNAME"
    HOSTNAME="$TUI_RESULT"

    ((current_step++))

    # Step 2: ISO type & label
    tui_clear
    tui_wizard_step $current_step $total_steps "ISO Type"

    local types=("live (Boot directly into RAM-based system)" "installer (Debian installer with preseed)")
    tui_radiolist "Select ISO type:" "${types[@]}"
    case $TUI_RESULT in
        0) ISO_TYPE="live" ;;
        1) ISO_TYPE="installer" ;;
    esac

    printf '\n'
    tui_input "Volume label" "$ISO_LABEL"
    ISO_LABEL="$TUI_RESULT"

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
            "ISO name|$IMAGE_NAME" \
            "Hostname|$HOSTNAME" \
            "ISO type|$ISO_TYPE" \
            "Volume label|$ISO_LABEL" \
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
                tui_input "ISO name" "$IMAGE_NAME"
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

    local iso_path="$OUTPUT_DIR/${IMAGE_NAME}.iso"

    echo -e "${GREEN}=== Linux ISO Builder ===${NC}"
    echo "Platform:     $PLATFORM"
    echo "ISO name:     $IMAGE_NAME"
    echo "ISO type:     $ISO_TYPE"
    echo "Debian:       $DEBIAN_RELEASE"
    echo "Hostname:     $HOSTNAME"
    echo "Volume label: $ISO_LABEL"
    echo "Output dir:   $OUTPUT_DIR"
    echo ""

    # Build ISO
    if $IS_MACOS; then
        build_iso_docker "$iso_path"
    else
        build_iso_linux "$iso_path"
    fi

    echo ""
    echo -e "${GREEN}=== Build Complete ===${NC}"
    echo "ISO: $iso_path ($(du -h "$iso_path" | cut -f1))"
    echo ""
    echo -e "${YELLOW}Root password: $ROOT_PASSWORD${NC}"
    if [ -n "$SSH_KEY" ]; then
        echo "SSH key installed to /root/.ssh/authorized_keys"
    fi
    echo ""
    echo "Boot methods:"
    echo "  BIOS:  Supported (ISOLINUX)"
    echo "  UEFI:  Supported (GRUB EFI)"
    echo "  USB:   dd if=$iso_path of=/dev/sdX bs=4M status=progress"
    echo ""
    echo "QEMU test:"
    echo "  qemu-system-x86_64 -m 1024 -cdrom $iso_path -boot d"
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
