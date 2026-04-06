# VM Provisioner

Provision and manage Firecracker, QEMU, and Docker Compose workloads with a real-time dashboard.

## Quick Start

```bash
bun server.js --port 3000 --images ./images
```

Then open http://localhost:3000

## Features

- **Multi-backend**: Firecracker, QEMU, and Docker Compose support
- **Real-time dashboard**: WebSocket-powered live stats and status updates
- **REST API**: Full CRUD operations for VM lifecycle management
- **Persistence**: Optional persistent VMs survive server restarts
- **Image scanning**: Auto-detects images by file extension

## CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `--port` | Server port | `3000` |
| `--images` | Images directory path | `./images` |

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Dashboard HTML |
| `GET` | `/api/vms` | List all VMs |
| `POST` | `/api/vms` | Create VM |
| `GET` | `/api/vms/:id` | Get single VM |
| `POST` | `/api/vms/:id/start` | Start VM |
| `POST` | `/api/vms/:id/stop` | Stop VM |
| `DELETE` | `/api/vms/:id` | Destroy VM |
| `GET` | `/api/images` | List available images |
| `GET` | `/api/stats` | Stats snapshot (all VMs) |
| `GET` | `/api/stats/:id` | Stats for single VM |
| `WS` | `/ws` | Real-time stats push |

## Creating a VM

```bash
curl -X POST http://localhost:3000/api/vms \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-vm",
    "backend": "qemu",
    "imagePath": "./images/debian.qcow2",
    "vcpus": 2,
    "memMb": 1024,
    "persistent": true
  }'
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | VM display name |
| `backend` | string | Yes | `firecracker`, `qemu`, or `docker-compose` |
| `imagePath` | string | Yes | Path to image file |
| `vcpus` | number | No | CPU count (default: 1) |
| `memMb` | number | No | Memory in MB (default: 256) |
| `persistent` | boolean | No | Survive server restart (default: false) |
| `config` | object | No | Backend-specific config |

### Backend-specific Config

**Firecracker:**
```json
{
  "config": {
    "kernelPath": "./images/vmlinux",
    "bootArgs": "console=ttyS0 reboot=k panic=1 pci=off",
    "tapDevice": "tap0",
    "guestMac": "AA:FC:00:00:00:01"
  }
}
```

**QEMU:**
```json
{
  "config": {
    "extraArgs": ["-enable-kvm", "-cpu", "host"]
  }
}
```

**Docker Compose:**
```json
{
  "config": {}
}
```
The `imagePath` should point to a docker-compose.yml file.

## Image Extensions

Images are auto-detected by extension:

| Backend | Extensions |
|---------|------------|
| Firecracker | `.ext4`, `.squashfs`, `.img` |
| QEMU | `.qcow2`, `.img`, `.raw`, `.iso` |
| Docker Compose | `.yml`, `.yaml` |

## WebSocket Protocol

Connect to `/ws` for real-time updates.

**Server → Client:**
```json
{"type": "stats", "data": {"vm-id": {"status": "running", "networkRxBytes": 1024, "networkTxBytes": 512, "ip": "10.0.0.2", "uptimeMs": 60000}}}
{"type": "vm_created", "data": {"vmId": "abc123", "vm": {...}}}
{"type": "vm_started", "data": {"vmId": "abc123", "vm": {...}}}
{"type": "vm_stopped", "data": {"vmId": "abc123", "vm": {...}}}
{"type": "vm_deleted", "data": {"vmId": "abc123"}}
```

**Client → Server:**
```json
{"type": "subscribe", "vmIds": ["vm1", "vm2"]}
{"type": "unsubscribe", "vmIds": ["vm1"]}
```

## Building Images

Use the companion image builders:

```bash
# Firecracker images (rootfs + kernel)
cd ../fc-image-builder
./build-image.sh -n my-fc-vm -s 1024 -H myhost

# QEMU images (bootable qcow2)
cd ../qemu-image-builder
./build-image.sh -n my-qemu-vm -s 8G -H myhost
```

Both output to `./images/` by default.

## Persistence

VMs marked as `persistent: true` are saved to `.vm-state.json` and recovered on server restart. The recovery process:

1. Loads VM configs from disk
2. Reconstructs socket paths from ID conventions
3. Probes each backend's `isRunning()` to detect still-running VMs
4. Updates status accordingly

## Project Structure

```
vm-provisioner/
├── server.js              # Entry point
├── lib/                   # Utils, constants, state helpers
├── server/                # HTTP server, routes, WebSocket
├── backends/              # Firecracker, QEMU, Docker Compose
├── vm/                    # Registry, lifecycle management
├── stats/                 # Collection, tracking, broadcast
├── images/                # Image scanner
├── persistence/           # JSON store, recovery
└── web/                   # Dashboard template
```

## Requirements

- [Bun](https://bun.sh) runtime
- For actual VM execution:
  - **Firecracker**: Linux with KVM, firecracker binary
  - **QEMU**: qemu-system-x86_64 binary
  - **Docker Compose**: Docker with compose plugin
