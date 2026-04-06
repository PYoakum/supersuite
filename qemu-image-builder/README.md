# QEMU Image Builder

Build bootable QEMU VM images (qcow2/raw) on macOS or Linux.

## Quick Start

```bash
# Build with defaults (8GB Debian bookworm qcow2 image)
./build-image.sh

# Custom build
./build-image.sh -n webserver -s 16G -P "nginx,vim" -H myvm
```

## Requirements

**macOS:**
- Docker Desktop

**Linux:**
- debootstrap
- qemu-utils (qemu-img)
- parted
- Root privileges (for mount/losetup)

```bash
# Debian/Ubuntu
sudo apt install debootstrap qemu-utils parted
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-n, --name` | Image name | `qemu-vm` |
| `-s, --size` | Disk size (e.g., 8G, 16G) | `8G` |
| `-r, --release` | Debian release | `bookworm` |
| `-o, --output` | Output directory | `../vm-provisioner/images` |
| `-f, --format` | Image format: qcow2, raw | `qcow2` |
| `-p, --password` | Root password | Random (printed) |
| `-K, --ssh-key` | SSH public key for root | None |
| `-P, --packages` | Extra packages (comma-sep) | None |
| `-H, --hostname` | VM hostname | `qemu-vm` |

## Output Files

```
../vm-provisioner/images/
  └── <name>.qcow2    - Bootable QEMU disk image
```

## Examples

### Basic image with SSH key
```bash
./build-image.sh -K "$(cat ~/.ssh/id_rsa.pub)"
```

### Web server image
```bash
./build-image.sh \
  -n nginx-server \
  -s 16G \
  -P "nginx,certbot,python3-certbot-nginx" \
  -H webserver
```

### Raw format for better performance
```bash
./build-image.sh -n fast-vm -f raw -s 8G
```

### Different Debian release
```bash
./build-image.sh -r bullseye -n oldstable
```

## Using with VM Provisioner

Images are output to `../vm-provisioner/images/` by default. Start the provisioner:

```bash
cd ../vm-provisioner
bun server.js --port 3000 --images ./images
```

Then create a QEMU VM via the dashboard or API:

```bash
curl -X POST http://localhost:3000/api/vms \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-qemu-vm",
    "backend": "qemu",
    "imagePath": "./images/qemu-vm.qcow2",
    "vcpus": 2,
    "memMb": 1024
  }'
```

## Image Contents

The image includes:
- Debian base system with Linux kernel
- GRUB bootloader (BIOS boot)
- OpenSSH server (root login enabled)
- systemd
- Serial console on ttyS0
- DHCP networking on eth0/ens3
- sudo, curl, ca-certificates

## Testing Manually

```bash
# Basic test (serial console)
qemu-system-x86_64 \
  -m 512 \
  -drive file=./images/qemu-vm.qcow2,format=qcow2 \
  -nographic

# With networking
qemu-system-x86_64 \
  -m 512 \
  -drive file=./images/qemu-vm.qcow2,format=qcow2 \
  -net nic,model=virtio \
  -net user,hostfwd=tcp::2222-:22 \
  -nographic

# Then SSH: ssh -p 2222 root@localhost
```

## Differences from Firecracker Images

| Feature | QEMU | Firecracker |
|---------|------|-------------|
| Bootloader | GRUB (included) | None (direct kernel) |
| Kernel | In image | Separate vmlinux file |
| Format | qcow2 (CoW, snapshots) | ext4 (raw rootfs) |
| Boot time | ~5-10 seconds | ~100ms |
| Use case | General VMs | Microservices, serverless |
