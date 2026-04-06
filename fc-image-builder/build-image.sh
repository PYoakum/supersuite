#!/bin/bash

# build-image.sh - Build Firecracker VM images (rootfs + kernel)
# Works on both macOS (via Docker) and Linux (native)
#
# Usage: ./build-image.sh [options]
#        ./build-image.sh              # Launch interactive TUI (if terminal)
#        ./build-image.sh -i           # Force interactive TUI mode
#
# Produces:
#   - rootfs.ext4: Root filesystem image
#   - vmlinux: Linux kernel binary (uncompressed)

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
IMAGE_NAME="firecracker-vm"
IMAGE_SIZE_MB=1024
DEBIAN_RELEASE="bookworm"
OUTPUT_DIR="../vm-provisioner/images"
KERNEL_VERSION="6.1"
ROOT_PASSWORD=""
SSH_KEY=""
PACKAGES="openssh-server,sudo,curl,ca-certificates,systemd-sysv"
EXTRA_PACKAGES=""
HOSTNAME="fc-vm"
INCLUDE_KERNEL=true
DOCKER_IMAGE="debian:bookworm"

# Advanced options
STARTUP_SCRIPT=""          # Path to startup script or inline content
STARTUP_SCRIPT_INLINE=""   # Inline script content
EXTERNAL_DEBS=""           # Newline-separated list of .deb URLs or paths
COPY_FILES=""              # Newline-separated "source:dest" pairs

# Package categories for TUI (format: "Category:pkg1,pkg2,pkg3")
PACKAGE_CATEGORIES=(
    "Web Servers:nginx,apache2,lighttpd,caddy"
    "Databases:postgresql,mariadb-server,redis-server,sqlite3"
    "Development:build-essential,git,vim,tmux,htop,jq"
    "Networking:net-tools,dnsutils,tcpdump,nmap,iptables"
    "Monitoring:prometheus-node-exporter,collectd,sysstat"
    "Security:fail2ban,ufw,certbot,openssl"
    "Containers:podman,docker.io,containerd"
    "Languages:python3,python3-pip,nodejs,npm,golang"
    "Utilities:rsync,wget,unzip,tree,ncdu,strace"
)

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

Build Firecracker VM images (rootfs + kernel) on macOS or Linux.

Options:
  -i, --interactive       Launch interactive TUI mode
  -n, --name NAME         Image name prefix (default: firecracker-vm)
  -s, --size SIZE         Root filesystem size in MB (default: 1024)
  -r, --release RELEASE   Debian release: bullseye, bookworm, trixie (default: bookworm)
  -o, --output DIR        Output directory (default: ../vm-provisioner/images)
  -k, --kernel VERSION    Kernel version: 5.10, 6.1, 6.6 (default: 6.1)
  -p, --password PASS     Root password (default: random, printed at end)
  -K, --ssh-key KEY       SSH public key to add to root's authorized_keys
  -P, --packages PKGS     Extra packages to install (comma-separated)
  -H, --hostname NAME     VM hostname (default: fc-vm)
  --no-kernel             Skip kernel download (rootfs only)
  --startup-script FILE   Script to run on first boot
  --external-deb URL      External .deb package to install (can be repeated)
  -h, --help              Show this help

Note: Running without arguments in a terminal launches interactive TUI mode.
      TUI mode provides an interactive package browser with categories.

Examples:
  $0                                    # Build with defaults
  $0 -n myvm -s 2048 -r bookworm        # 2GB bookworm image
  $0 -K "\$(cat ~/.ssh/id_rsa.pub)"       # Add SSH key
  $0 -P "nginx,vim" -H webserver        # Add packages, set hostname

Platform: $PLATFORM
$(if $IS_MACOS; then echo "  macOS detected - will use Docker for image building"; fi)

Output files:
  <output>/<name>-rootfs.ext4    - Root filesystem
  <output>/<name>-vmlinux        - Kernel binary (unless --no-kernel)
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
                IMAGE_SIZE_MB="$2"
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
            -k|--kernel)
                KERNEL_VERSION="$2"
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
            --no-kernel)
                INCLUDE_KERNEL=false
                shift
                ;;
            --startup-script)
                STARTUP_SCRIPT="$2"
                shift 2
                ;;
            --external-deb)
                [ -n "$EXTERNAL_DEBS" ] && EXTERNAL_DEBS+=$'\n'
                EXTERNAL_DEBS+="$2"
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
    for cmd in debootstrap mkfs.ext4 mount; do
        if ! command -v $cmd &> /dev/null; then
            missing+=($cmd)
        fi
    done
    if [ ${#missing[@]} -gt 0 ]; then
        echo -e "${RED}Error: Missing required commands: ${missing[*]}${NC}"
        echo "Install with: sudo apt install debootstrap e2fsprogs"
        exit 1
    fi
    if [ "$(id -u)" -ne 0 ]; then
        echo -e "${RED}Error: Must run as root on Linux (need mount permissions)${NC}"
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

download_kernel() {
    local output_path="$1"
    local kernel_url=""

    # Use pre-built Firecracker-compatible kernels from Amazon
    case "$KERNEL_VERSION" in
        5.10)
            kernel_url="https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/v1.9/x86_64/vmlinux-5.10.217"
            ;;
        6.1)
            kernel_url="https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/v1.9/x86_64/vmlinux-6.1.102"
            ;;
        6.6)
            # Fallback to 6.1 if 6.6 not available
            kernel_url="https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/v1.9/x86_64/vmlinux-6.1.102"
            echo -e "${YELLOW}Note: Using kernel 6.1 (6.6 not yet available from Firecracker CI)${NC}"
            ;;
        *)
            echo -e "${RED}Unknown kernel version: $KERNEL_VERSION${NC}"
            echo "Supported: 5.10, 6.1, 6.6"
            exit 1
            ;;
    esac

    echo -e "${GREEN}Downloading kernel...${NC}"
    curl -fSL "$kernel_url" -o "$output_path"
    chmod 644 "$output_path"
}

build_rootfs_linux() {
    local rootfs_path="$1"
    local mount_point="/tmp/fc-rootfs-$$"

    echo -e "${GREEN}Creating ${IMAGE_SIZE_MB}MB ext4 image...${NC}"
    dd if=/dev/zero of="$rootfs_path" bs=1M count="$IMAGE_SIZE_MB" status=progress
    mkfs.ext4 -F "$rootfs_path"

    echo -e "${GREEN}Mounting image...${NC}"
    mkdir -p "$mount_point"
    mount -o loop "$rootfs_path" "$mount_point"

    # Cleanup on exit
    trap "umount '$mount_point' 2>/dev/null; rmdir '$mount_point' 2>/dev/null" EXIT

    echo -e "${GREEN}Running debootstrap ($DEBIAN_RELEASE)...${NC}"
    local all_packages="$PACKAGES"
    if [ -n "$EXTRA_PACKAGES" ]; then
        all_packages="$all_packages,$EXTRA_PACKAGES"
    fi
    debootstrap --include="$all_packages" "$DEBIAN_RELEASE" "$mount_point" http://deb.debian.org/debian

    configure_rootfs "$mount_point"

    echo -e "${GREEN}Unmounting...${NC}"
    umount "$mount_point"
    rmdir "$mount_point"
    trap - EXIT
}

build_rootfs_docker() {
    local rootfs_path="$1"
    local script_dir="$(cd "$(dirname "$0")" && pwd)"
    local build_dir="/tmp/fc-build-$$"

    mkdir -p "$build_dir"
    mkdir -p "$build_dir/extras"

    # Copy startup script if specified
    if [ -n "$STARTUP_SCRIPT" ] && [ -f "$STARTUP_SCRIPT" ]; then
        cp "$STARTUP_SCRIPT" "$build_dir/extras/startup-script.sh"
    elif [ -n "$STARTUP_SCRIPT_INLINE" ]; then
        echo "$STARTUP_SCRIPT_INLINE" > "$build_dir/extras/startup-script.sh"
    fi

    # Save external debs list
    if [ -n "$EXTERNAL_DEBS" ]; then
        echo "$EXTERNAL_DEBS" > "$build_dir/extras/external-debs.txt"
    fi

    # Generate the in-container build script
    cat > "$build_dir/build-in-docker.sh" << 'DOCKERSCRIPT'
#!/bin/bash
set -e

ROOTFS_PATH="$1"
IMAGE_SIZE_MB="$2"
DEBIAN_RELEASE="$3"
PACKAGES="$4"
ROOT_PASSWORD="$5"
SSH_KEY="$6"
HOSTNAME="$7"
EXTRAS_DIR="$8"

apt-get update
apt-get install -y debootstrap e2fsprogs curl

echo "Creating ${IMAGE_SIZE_MB}MB ext4 image..."
dd if=/dev/zero of="$ROOTFS_PATH" bs=1M count="$IMAGE_SIZE_MB" status=progress
mkfs.ext4 -F "$ROOTFS_PATH"

MOUNT_POINT="/mnt/rootfs"
mkdir -p "$MOUNT_POINT"
mount -o loop "$ROOTFS_PATH" "$MOUNT_POINT"

echo "Running debootstrap ($DEBIAN_RELEASE)..."
debootstrap --include="$PACKAGES" "$DEBIAN_RELEASE" "$MOUNT_POINT" http://deb.debian.org/debian

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
sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' "$MOUNT_POINT/etc/ssh/sshd_config"
sed -i 's/PermitRootLogin.*/PermitRootLogin yes/' "$MOUNT_POINT/etc/ssh/sshd_config"

# Configure serial console for Firecracker
mkdir -p "$MOUNT_POINT/etc/systemd/system/serial-getty@ttyS0.service.d"
cat > "$MOUNT_POINT/etc/systemd/system/serial-getty@ttyS0.service.d/override.conf" << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root -o '-p -- \\u' --keep-baud 115200,57600,38400,9600 %I \$TERM
EOF

# Enable serial console
chroot "$MOUNT_POINT" systemctl enable serial-getty@ttyS0.service

# Configure network (DHCP on eth0)
cat > "$MOUNT_POINT/etc/network/interfaces" << EOF
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp
EOF

# Disable kernel messages to console (noisy)
echo "kernel.printk = 3 4 1 3" > "$MOUNT_POINT/etc/sysctl.d/99-quiet-printk.conf"

# Install external .deb packages
if [ -f "$EXTRAS_DIR/external-debs.txt" ]; then
    echo "Installing external packages..."
    mkdir -p "$MOUNT_POINT/tmp/debs"
    while IFS= read -r deb_source; do
        [ -z "$deb_source" ] && continue
        deb_name=$(basename "$deb_source")
        echo "  Fetching: $deb_name"
        if [[ "$deb_source" == http* ]]; then
            curl -fSL "$deb_source" -o "$MOUNT_POINT/tmp/debs/$deb_name"
        elif [ -f "$deb_source" ]; then
            cp "$deb_source" "$MOUNT_POINT/tmp/debs/$deb_name"
        fi
    done < "$EXTRAS_DIR/external-debs.txt"

    # Install all downloaded debs
    if ls "$MOUNT_POINT/tmp/debs/"*.deb 1>/dev/null 2>&1; then
        chroot "$MOUNT_POINT" bash -c 'dpkg -i /tmp/debs/*.deb || apt-get install -f -y'
    fi
    rm -rf "$MOUNT_POINT/tmp/debs"
fi

# Install startup script as systemd service
if [ -f "$EXTRAS_DIR/startup-script.sh" ]; then
    echo "Installing startup script..."
    cp "$EXTRAS_DIR/startup-script.sh" "$MOUNT_POINT/usr/local/bin/fc-startup.sh"
    chmod +x "$MOUNT_POINT/usr/local/bin/fc-startup.sh"

    cat > "$MOUNT_POINT/etc/systemd/system/fc-startup.service" << EOF
[Unit]
Description=Firecracker VM Startup Script
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/fc-startup.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

    chroot "$MOUNT_POINT" systemctl enable fc-startup.service
    echo "  Startup script installed as fc-startup.service"
fi

# Create a simple init script for faster boot
cat > "$MOUNT_POINT/etc/rc.local" << 'EOF'
#!/bin/bash
# Firecracker VM init
exit 0
EOF
chmod +x "$MOUNT_POINT/etc/rc.local"

# Set timezone
chroot "$MOUNT_POINT" ln -sf /usr/share/zoneinfo/UTC /etc/localtime

# Clean up
chroot "$MOUNT_POINT" apt-get clean
rm -rf "$MOUNT_POINT/var/lib/apt/lists/"*
rm -rf "$MOUNT_POINT/var/cache/apt/"*
rm -rf "$MOUNT_POINT/tmp/"*
rm -rf "$MOUNT_POINT/var/tmp/"*

echo "Unmounting..."
umount "$MOUNT_POINT"
echo "Done!"
DOCKERSCRIPT

    chmod +x "$build_dir/build-in-docker.sh"

    # Prepare packages list
    local all_packages="$PACKAGES"
    if [ -n "$EXTRA_PACKAGES" ]; then
        all_packages="$all_packages,$EXTRA_PACKAGES"
    fi

    echo -e "${GREEN}Building rootfs in Docker container...${NC}"
    docker run --rm --privileged \
        -v "$build_dir:/build" \
        -v "$(dirname "$rootfs_path"):/output" \
        "$DOCKER_IMAGE" \
        /build/build-in-docker.sh \
        "/output/$(basename "$rootfs_path")" \
        "$IMAGE_SIZE_MB" \
        "$DEBIAN_RELEASE" \
        "$all_packages" \
        "$ROOT_PASSWORD" \
        "$SSH_KEY" \
        "$HOSTNAME" \
        "/build/extras"

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
    sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' "$mount_point/etc/ssh/sshd_config"
    sed -i 's/PermitRootLogin.*/PermitRootLogin yes/' "$mount_point/etc/ssh/sshd_config"

    # Configure serial console for Firecracker
    mkdir -p "$mount_point/etc/systemd/system/serial-getty@ttyS0.service.d"
    cat > "$mount_point/etc/systemd/system/serial-getty@ttyS0.service.d/override.conf" << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin root -o '-p -- \\u' --keep-baud 115200,57600,38400,9600 %I \$TERM
EOF
    chroot "$mount_point" systemctl enable serial-getty@ttyS0.service

    # Configure network (DHCP on eth0)
    cat > "$mount_point/etc/network/interfaces" << EOF
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp
EOF

    # Disable kernel messages to console
    echo "kernel.printk = 3 4 1 3" > "$mount_point/etc/sysctl.d/99-quiet-printk.conf"

    # Install external .deb packages
    if [ -n "$EXTERNAL_DEBS" ]; then
        echo -e "${GREEN}Installing external packages...${NC}"
        mkdir -p "$mount_point/tmp/debs"
        while IFS= read -r deb_source; do
            [ -z "$deb_source" ] && continue
            local deb_name=$(basename "$deb_source")
            echo "  Fetching: $deb_name"
            if [[ "$deb_source" == http* ]]; then
                curl -fSL "$deb_source" -o "$mount_point/tmp/debs/$deb_name"
            elif [ -f "$deb_source" ]; then
                cp "$deb_source" "$mount_point/tmp/debs/$deb_name"
            fi
        done <<< "$EXTERNAL_DEBS"

        if ls "$mount_point/tmp/debs/"*.deb 1>/dev/null 2>&1; then
            chroot "$mount_point" bash -c 'dpkg -i /tmp/debs/*.deb || apt-get install -f -y'
        fi
        rm -rf "$mount_point/tmp/debs"
    fi

    # Install startup script as systemd service
    if [ -n "$STARTUP_SCRIPT" ] && [ -f "$STARTUP_SCRIPT" ]; then
        echo -e "${GREEN}Installing startup script...${NC}"
        cp "$STARTUP_SCRIPT" "$mount_point/usr/local/bin/fc-startup.sh"
        chmod +x "$mount_point/usr/local/bin/fc-startup.sh"
        install_startup_service "$mount_point"
    elif [ -n "$STARTUP_SCRIPT_INLINE" ]; then
        echo -e "${GREEN}Installing startup script...${NC}"
        echo "$STARTUP_SCRIPT_INLINE" > "$mount_point/usr/local/bin/fc-startup.sh"
        chmod +x "$mount_point/usr/local/bin/fc-startup.sh"
        install_startup_service "$mount_point"
    fi

    # Set timezone
    chroot "$mount_point" ln -sf /usr/share/zoneinfo/UTC /etc/localtime

    # Clean up
    chroot "$mount_point" apt-get clean
    rm -rf "$mount_point/var/lib/apt/lists/"*
    rm -rf "$mount_point/var/cache/apt/"*
    rm -rf "$mount_point/tmp/"*
    rm -rf "$mount_point/var/tmp/"*
}

install_startup_service() {
    local mount_point="$1"

    cat > "$mount_point/etc/systemd/system/fc-startup.service" << EOF
[Unit]
Description=Firecracker VM Startup Script
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/fc-startup.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

    chroot "$mount_point" systemctl enable fc-startup.service
    echo "  Startup script installed as fc-startup.service"
}

# ============================================================================
# TUI Mode Functions
# ============================================================================

run_tui_mode() {
    tui_setup_cleanup
    tui_wizard_start

    # Welcome screen
    tui_welcome_screen \
        "Firecracker Image Builder" \
        "Build minimal VM images for Firecracker" \
        "$PLATFORM"

    local total_steps=8
    local current_step=1

    # Step 1: Basic settings
    tui_clear
    tui_wizard_step $current_step $total_steps "Basic Settings"

    tui_input "Image name" "$IMAGE_NAME"
    IMAGE_NAME="$TUI_RESULT"

    tui_input "Hostname" "$HOSTNAME"
    HOSTNAME="$TUI_RESULT"

    tui_input "Size (MB)" "$IMAGE_SIZE_MB"
    IMAGE_SIZE_MB="$TUI_RESULT"

    ((current_step++))

    # Step 2: Debian release
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

    # Step 3: Kernel settings
    tui_clear
    tui_wizard_step $current_step $total_steps "Kernel Settings"

    local kernels=("6.1 (Recommended)" "5.10 (LTS)" "6.6")
    tui_radiolist "Select kernel version:" "${kernels[@]}"
    case $TUI_RESULT in
        0) KERNEL_VERSION="6.1" ;;
        1) KERNEL_VERSION="5.10" ;;
        2) KERNEL_VERSION="6.6" ;;
    esac

    printf '\n'
    tui_checkbox "Include kernel binary" 0
    if [ $? -eq 0 ]; then
        INCLUDE_KERNEL=true
    else
        INCLUDE_KERNEL=false
    fi

    ((current_step++))

    # Step 4: Package Browser
    tui_clear
    tui_wizard_step $current_step $total_steps "Package Selection"

    printf '%bBase packages (always installed):%b\n' "$TUI_DIM" "$TUI_NC"
    printf '  %s\n\n' "$PACKAGES"

    printf 'Select additional packages by category:\n\n'

    # Pass PACKAGE_CATEGORIES directly to tui_tree
    tui_tree "Package Categories" "${PACKAGE_CATEGORIES[@]}"
    EXTRA_PACKAGES="$TUI_RESULT"

    # Custom packages with examples
    printf '\n'
    printf '%b┌─ Custom Packages ─────────────────────────────────────────┐%b\n' "$TUI_DIM" "$TUI_NC"
    printf '%b│%b Add any Debian package not listed above.                  %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b                                                           %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b %bExamples:%b                                                 %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_CYAN" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b   neovim                    %b(single package)%b             %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b   neovim,ripgrep,fd-find    %b(multiple packages)%b          %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b   python3-flask             %b(python library)%b             %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b                                                           %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b %bTip:%b Use "apt search <name>" to find package names.       %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_YELLOW" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b└───────────────────────────────────────────────────────────┘%b\n' "$TUI_DIM" "$TUI_NC"
    printf '\n'

    tui_input "Additional packages (comma-separated, or Enter to skip)" ""
    if [ -n "$TUI_RESULT" ]; then
        [ -n "$EXTRA_PACKAGES" ] && EXTRA_PACKAGES+=","
        EXTRA_PACKAGES+="$TUI_RESULT"
    fi

    ((current_step++))

    # Step 5: Startup Scripts
    tui_clear
    tui_wizard_step $current_step $total_steps "Startup Scripts"

    printf '%b┌─ Startup Script ──────────────────────────────────────────┐%b\n' "$TUI_DIM" "$TUI_NC"
    printf '%b│%b Run custom commands when the VM boots.                    %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b Installed as a systemd service (runs after networking).  %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b                                                           %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b %bCommon uses:%b                                              %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_CYAN" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b   • Start application services                           %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b   • Configure networking or firewall rules               %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b   • Mount additional filesystems                         %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b   • Pull configuration from remote source                %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b   • Register with orchestration system                   %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b└───────────────────────────────────────────────────────────┘%b\n' "$TUI_DIM" "$TUI_NC"
    printf '\n'

    local script_options=("Skip (no startup script)" "Browse for existing script file" "Write script inline (with template)")
    tui_radiolist "Startup script:" "${script_options[@]}"

    case $TUI_RESULT in
        0)  # Skip
            STARTUP_SCRIPT=""
            STARTUP_SCRIPT_INLINE=""
            ;;
        1)  # Browse
            printf '\n'
            printf '%bNavigate to your script file. Must be executable bash script.%b\n\n' "$TUI_DIM" "$TUI_NC"
            tui_file_browser "Select startup script" "$HOME"
            if [ -n "$TUI_RESULT" ] && [ -f "$TUI_RESULT" ]; then
                STARTUP_SCRIPT="$TUI_RESULT"
                printf '\n%b✓ Selected:%b %s\n' "$TUI_GREEN" "$TUI_NC" "$STARTUP_SCRIPT"
                sleep 1
            fi
            ;;
        2)  # Inline
            printf '\n'
            printf '%bEdit the template below. Use Ctrl+D when done, Ctrl+C to cancel.%b\n\n' "$TUI_DIM" "$TUI_NC"
            local default_script='#!/bin/bash
# =============================================================================
# Firecracker VM Startup Script
# =============================================================================
# This script runs automatically on every boot as a systemd service.
# It runs AFTER the network is available.
#
# Logs: journalctl -u fc-startup.service
# =============================================================================

set -e  # Exit on error

# Log startup
echo "[$(date)] VM startup script running..." >> /var/log/fc-startup.log

# -----------------------------------------------------------------------------
# Example: Start a web server
# -----------------------------------------------------------------------------
# systemctl start nginx

# -----------------------------------------------------------------------------
# Example: Pull config from metadata service (like cloud-init)
# -----------------------------------------------------------------------------
# curl -s http://169.254.169.254/latest/user-data | bash

# -----------------------------------------------------------------------------
# Example: Set up firewall rules
# -----------------------------------------------------------------------------
# iptables -A INPUT -p tcp --dport 22 -j ACCEPT
# iptables -A INPUT -p tcp --dport 80 -j ACCEPT
# iptables -A INPUT -j DROP

# -----------------------------------------------------------------------------
# Example: Mount shared filesystem
# -----------------------------------------------------------------------------
# mount -t virtiofs shared /mnt/shared

# -----------------------------------------------------------------------------
# Add your commands below
# -----------------------------------------------------------------------------


echo "[$(date)] Startup complete" >> /var/log/fc-startup.log
exit 0'
            tui_editor "Write startup script (Ctrl+D to save)" "$default_script"
            STARTUP_SCRIPT_INLINE="$TUI_RESULT"
            ;;
    esac

    ((current_step++))

    # Step 6: External Packages
    tui_clear
    tui_wizard_step $current_step $total_steps "External Packages"

    printf '%b┌─ External .deb Packages ──────────────────────────────────┐%b\n' "$TUI_DIM" "$TUI_NC"
    printf '%b│%b Install packages not available in Debian repositories.   %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b Provide direct download URLs or local file paths.        %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b                                                           %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b %bExample URLs:%b                                             %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_CYAN" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b   https://example.com/app_1.0_amd64.deb                  %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b   https://github.com/user/repo/releases/download/v1/... %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b                                                           %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b %bExample local paths:%b                                      %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_CYAN" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b   /home/user/packages/myapp_1.0_amd64.deb                %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b   ./custom-tool.deb                                      %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b                                                           %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b│%b %bNote:%b Packages must be for amd64 architecture.            %b│%b\n' "$TUI_DIM" "$TUI_NC" "$TUI_YELLOW" "$TUI_NC" "$TUI_DIM" "$TUI_NC"
    printf '%b└───────────────────────────────────────────────────────────┘%b\n' "$TUI_DIM" "$TUI_NC"
    printf '\n'

    local ext_options=("Skip (no external packages)" "Add external .deb packages")
    tui_radiolist "External packages:" "${ext_options[@]}"

    case $TUI_RESULT in
        0)  # Skip
            EXTERNAL_DEBS=""
            ;;
        1)  # Add
            printf '\n'
            printf '%bEnter one URL or path per line. Press Enter on empty line when done.%b\n\n' "$TUI_DIM" "$TUI_NC"
            tui_list_input "External .deb Packages" "URL or path"
            EXTERNAL_DEBS="$TUI_RESULT"
            ;;
    esac

    ((current_step++))

    # Step 7: Authentication
    tui_clear
    tui_wizard_step $current_step $total_steps "Authentication"

    printf 'Root password (leave empty for random):\n'
    tui_password "Password"
    ROOT_PASSWORD="$TUI_RESULT"

    printf '\n'
    tui_input "SSH public key (optional)" "$SSH_KEY"
    SSH_KEY="$TUI_RESULT"

    ((current_step++))

    # Step 8: Summary & Confirm
    while true; do
        tui_clear
        tui_wizard_step $current_step $total_steps "Summary"

        # Count external debs
        local ext_deb_count=0
        if [ -n "$EXTERNAL_DEBS" ]; then
            ext_deb_count=$(echo "$EXTERNAL_DEBS" | wc -l | tr -d ' ')
        fi

        # Format startup script info
        local startup_info="none"
        if [ -n "$STARTUP_SCRIPT" ]; then
            startup_info="file: $(basename "$STARTUP_SCRIPT")"
        elif [ -n "$STARTUP_SCRIPT_INLINE" ]; then
            startup_info="inline script"
        fi

        printf '\n'
        tui_summary \
            "Image name|$IMAGE_NAME" \
            "Hostname|$HOSTNAME" \
            "Size|${IMAGE_SIZE_MB}MB" \
            "Debian|$DEBIAN_RELEASE" \
            "Kernel|$KERNEL_VERSION" \
            "Include kernel|$( $INCLUDE_KERNEL && echo 'Yes' || echo 'No' )" \
            "Extra packages|${EXTRA_PACKAGES:-none}" \
            "Startup script|$startup_info" \
            "External .debs|${ext_deb_count} package(s)" \
            "SSH key|$( [ -n "$SSH_KEY" ] && echo 'configured' || echo 'none' )" \
            "Output|$OUTPUT_DIR"

        # Show package list if any
        if [ -n "$EXTRA_PACKAGES" ]; then
            printf '\n%bSelected packages:%b\n' "$TUI_DIM" "$TUI_NC"
            echo "$EXTRA_PACKAGES" | tr ',' '\n' | while read -r pkg; do
                [ -n "$pkg" ] && printf '  - %s\n' "$pkg"
            done
        fi

        # Show external debs if any
        if [ -n "$EXTERNAL_DEBS" ]; then
            printf '\n%bExternal packages:%b\n' "$TUI_DIM" "$TUI_NC"
            echo "$EXTERNAL_DEBS" | while read -r deb; do
                [ -n "$deb" ] && printf '  - %s\n' "$(basename "$deb")"
            done
        fi

        printf '\n\n'
        tui_buttons "Build" "Edit" "Cancel"

        case $TUI_RESULT in
            0)  # Build
                break
                ;;
            1)  # Edit - go back to step 1
                current_step=1
                tui_clear
                tui_wizard_step $current_step $total_steps "Basic Settings"
                tui_input "Image name" "$IMAGE_NAME"
                IMAGE_NAME="$TUI_RESULT"
                tui_input "Hostname" "$HOSTNAME"
                HOSTNAME="$TUI_RESULT"
                tui_input "Size (MB)" "$IMAGE_SIZE_MB"
                IMAGE_SIZE_MB="$TUI_RESULT"
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

    local rootfs_path="$OUTPUT_DIR/${IMAGE_NAME}-rootfs.ext4"
    local kernel_path="$OUTPUT_DIR/${IMAGE_NAME}-vmlinux"

    echo -e "${GREEN}=== Firecracker Image Builder ===${NC}"
    echo "Platform:     $PLATFORM"
    echo "Image name:   $IMAGE_NAME"
    echo "Image size:   ${IMAGE_SIZE_MB}MB"
    echo "Debian:       $DEBIAN_RELEASE"
    echo "Kernel:       $KERNEL_VERSION"
    echo "Hostname:     $HOSTNAME"
    echo "Output dir:   $OUTPUT_DIR"
    if [ -n "$EXTRA_PACKAGES" ]; then
        echo "Packages:     $EXTRA_PACKAGES"
    fi
    if [ -n "$STARTUP_SCRIPT" ]; then
        echo "Startup:      $STARTUP_SCRIPT"
    elif [ -n "$STARTUP_SCRIPT_INLINE" ]; then
        echo "Startup:      inline script"
    fi
    if [ -n "$EXTERNAL_DEBS" ]; then
        local deb_count=$(echo "$EXTERNAL_DEBS" | grep -c .)
        echo "External:     $deb_count .deb package(s)"
    fi
    echo ""

    # Download kernel first (doesn't require privileges)
    if $INCLUDE_KERNEL; then
        download_kernel "$kernel_path"
    fi

    # Build rootfs
    if $IS_MACOS; then
        build_rootfs_docker "$rootfs_path"
    else
        build_rootfs_linux "$rootfs_path"
    fi

    echo ""
    echo -e "${GREEN}=== Build Complete ===${NC}"
    echo "Rootfs: $rootfs_path ($(du -h "$rootfs_path" | cut -f1))"
    if $INCLUDE_KERNEL; then
        echo "Kernel: $kernel_path ($(du -h "$kernel_path" | cut -f1))"
    fi
    echo ""
    echo -e "${YELLOW}Root password: $ROOT_PASSWORD${NC}"
    if [ -n "$SSH_KEY" ]; then
        echo "SSH key installed to /root/.ssh/authorized_keys"
    fi
    if [ -n "$STARTUP_SCRIPT" ] || [ -n "$STARTUP_SCRIPT_INLINE" ]; then
        echo "Startup script installed as fc-startup.service"
    fi
    echo ""
    echo "To use with vm-provisioner, the image is already in the images directory."
    echo ""
    echo "Manual Firecracker test:"
    echo "  firecracker --api-sock /tmp/fc.sock"
    echo "  # Then configure via API or use firectl"
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
