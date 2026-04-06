# Firecracker Image Builder

Build Firecracker VM images (rootfs + kernel) on macOS or Linux.

## Quick Start

```bash
# Build with defaults (1GB Debian bookworm image)
./build-image.sh

# Custom build
./build-image.sh -n webserver -s 2048 -P "nginx,vim" -H myvm
```

## Requirements

**macOS:**
- Docker Desktop

**Linux:**
- debootstrap
- e2fsprogs (mkfs.ext4)
- Root privileges (for mount)

```bash
# Debian/Ubuntu
sudo apt install debootstrap e2fsprogs
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-n, --name` | Image name prefix | `firecracker-vm` |
| `-s, --size` | Rootfs size in MB | `1024` |
| `-r, --release` | Debian release | `bookworm` |
| `-o, --output` | Output directory | `../vm-provisioner/images` |
| `-k, --kernel` | Kernel version (5.10, 6.1) | `6.1` |
| `-p, --password` | Root password | Random (printed) |
| `-K, --ssh-key` | SSH public key for root | None |
| `-P, --packages` | Extra packages (comma-sep) | None |
| `-H, --hostname` | VM hostname | `fc-vm` |
| `--no-kernel` | Skip kernel download | Include kernel |

## Output Files

```
../vm-provisioner/images/
  ├── <name>-rootfs.ext4   # Root filesystem
  └── <name>-vmlinux       # Linux kernel binary
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
  -s 2048 \
  -P "nginx,certbot,python3-certbot-nginx" \
  -H webserver
```

### Minimal image (rootfs only, BYO kernel)
```bash
./build-image.sh -n minimal -s 512 --no-kernel
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

Then create a Firecracker VM via the dashboard or API:

```bash
curl -X POST http://localhost:3000/api/vms \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-fc-vm",
    "backend": "firecracker",
    "imagePath": "./images/firecracker-vm-rootfs.ext4",
    "vcpus": 2,
    "memMb": 512,
    "config": {
      "kernelPath": "./images/firecracker-vm-vmlinux",
      "bootArgs": "console=ttyS0 reboot=k panic=1 pci=off"
    }
  }'
```

## Image Contents

The rootfs includes:
- Debian base system
- OpenSSH server (root login enabled)
- systemd
- Serial console configured for ttyS0
- DHCP networking on eth0
- sudo, curl, ca-certificates

## Kernel Sources

Kernels are pre-built binaries from the [Firecracker CI](https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md#get-a-guest-kernel-image):
- Configured for Firecracker (virtio, etc.)
- No modules needed
- Fast boot (~100ms)
