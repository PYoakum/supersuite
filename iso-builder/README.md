# Linux ISO Builder

Build bootable Linux live ISO images on macOS or Linux.

## Quick Start

```bash
# Build with defaults (Debian bookworm live ISO)
./build-iso.sh

# Custom build
./build-iso.sh -n rescue -P "vim,htop,tmux" -H rescue-system
```

## Requirements

**macOS:**
- Docker Desktop

**Linux:**
- debootstrap
- xorriso
- squashfs-tools
- grub-pc-bin, grub-efi-amd64-bin
- isolinux, syslinux-common
- mtools, dosfstools
- Root privileges

```bash
# Debian/Ubuntu
sudo apt install debootstrap xorriso squashfs-tools grub-pc-bin \
    grub-efi-amd64-bin isolinux syslinux-common mtools dosfstools
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-n, --name` | ISO name | `linux-live` |
| `-t, --type` | ISO type: live | `live` |
| `-r, --release` | Debian release | `bookworm` |
| `-o, --output` | Output directory | `../vm-provisioner/images` |
| `-p, --password` | Root password | Random (printed) |
| `-K, --ssh-key` | SSH public key for root | None |
| `-P, --packages` | Extra packages (comma-sep) | None |
| `-H, --hostname` | Default hostname | `linux-live` |
| `-l, --label` | ISO volume label | `LINUX_LIVE` |

## Output

```
../vm-provisioner/images/
  └── <name>.iso    - Bootable hybrid ISO (BIOS + UEFI)
```

## Examples

### Basic live ISO with SSH key
```bash
./build-iso.sh -K "$(cat ~/.ssh/id_rsa.pub)"
```

### Rescue/recovery ISO
```bash
./build-iso.sh \
  -n rescue \
  -P "vim,htop,tmux,rsync,parted,mdadm,lvm2,cryptsetup" \
  -H rescue
```

### Network tools ISO
```bash
./build-iso.sh \
  -n nettools \
  -P "nmap,tcpdump,wireshark-common,netcat-openbsd,iperf3" \
  -H nettools
```

### Different Debian release
```bash
./build-iso.sh -r trixie -n testing
```

## Boot Methods

The ISO is a hybrid image supporting multiple boot methods:

| Method | Support | Notes |
|--------|---------|-------|
| BIOS CD/DVD | Yes | ISOLINUX bootloader |
| UEFI CD/DVD | Yes | GRUB EFI |
| BIOS USB | Yes | isohybrid MBR |
| UEFI USB | Yes | GPT + EFI partition |

### Write to USB

```bash
# Find USB device
lsblk

# Write ISO (replace /dev/sdX with your device)
sudo dd if=linux-live.iso of=/dev/sdX bs=4M status=progress
sync
```

## Testing with QEMU

```bash
# BIOS boot
qemu-system-x86_64 -m 1024 -cdrom linux-live.iso -boot d

# UEFI boot (requires OVMF)
qemu-system-x86_64 -m 1024 \
  -bios /usr/share/ovmf/OVMF.fd \
  -cdrom linux-live.iso -boot d

# With networking and serial console
qemu-system-x86_64 -m 1024 \
  -cdrom linux-live.iso -boot d \
  -net nic -net user,hostfwd=tcp::2222-:22 \
  -nographic -serial mon:stdio
```

## ISO Contents

The live ISO includes:
- Debian base system
- Linux kernel + initramfs with live-boot
- SquashFS compressed root filesystem
- OpenSSH server (root login enabled)
- systemd
- Serial console support (ttyS0)
- DHCP networking on eth0

## Boot Menu

The ISO presents a boot menu with options:
1. **Start Live** - Normal graphical/text boot
2. **Start Live (Serial Console)** - Output to ttyS0 for headless systems

## Using with VM Provisioner

ISOs are detected by the VM provisioner for QEMU backend:

```bash
curl -X POST http://localhost:3000/api/vms \
  -H "Content-Type: application/json" \
  -d '{
    "name": "live-system",
    "backend": "qemu",
    "imagePath": "./images/linux-live.iso",
    "vcpus": 2,
    "memMb": 1024
  }'
```

## How It Works

1. **Debootstrap** creates a minimal Debian system
2. **Configuration** sets up SSH, networking, hostname, password
3. **mksquashfs** compresses the root filesystem
4. **Kernel/initrd** extracted for live boot
5. **ISOLINUX** provides BIOS boot support
6. **GRUB EFI** provides UEFI boot support
7. **xorriso** creates the final hybrid ISO image

The `live-boot` package handles mounting the squashfs and setting up an overlayfs for the live session.
