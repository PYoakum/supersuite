# Codebaux Guest Image Build Pipeline

Build system for creating the v86-compatible Linux guest image used by the Codebaux browser sandbox.

## Quick Start

```bash
# Full build (requires Docker)
./build-guest.sh

# Resume from a specific step
./build-guest.sh --from 03

# Run a single step
./build-guest.sh --only 04

# Preview what would run
./build-guest.sh --dry-run
```

## Prerequisites

| Tool | Required | Purpose |
|------|----------|---------|
| Docker 20.10+ | Yes | Build the i386 Alpine image |
| bash 5.0+ | Yes | Script execution |
| Node.js 18+ | Optional | Template validation, state snapshot |
| Python 3.8+ | Optional | fs.json manifest generation |
| QEMU | Optional | Live boot validation |
| jq 1.6+ | Optional | JSON validation |

## Build Steps

| Step | Script | Description |
|------|--------|-------------|
| 01 | `01-fetch-v86-deps.sh` | Download v86 WASM, BIOS ROMs |
| 02 | `02-build-base-image.sh` | Build Alpine i386 via Docker, extract rootfs |
| 03 | `03-apply-overlay.sh` | Apply /workspace dirs, config, cleanup |
| 04 | `04-install-helpers.sh` | Install protocol helper scripts |
| 05 | `05-configure-init.sh` | Wire OpenRC service, serial console |
| 06 | `06-validate-boot.sh` | Static + QEMU boot validation |
| 07 | `07-integration-tests.sh` | Protocol and script integration tests |
| 08 | `08-package.sh` | Generate fs.json, size report, config |

## Output

```
dist/guest/
  vmlinuz-lts           # 32-bit Linux kernel
  initramfs-lts         # initramfs with 9p mount hook
  rootfs/               # flat filesystem (served via 9p)
  fs.json               # v86 filesystem manifest
  v86.wasm              # v86 WebAssembly binary
  libv86.js             # v86 JavaScript runtime
  seabios.bin           # BIOS ROM
  vgabios.bin           # VGA BIOS ROM
  manifest.json         # Build metadata
  v86-config.js.example # Host integration reference
```

## Project Structure

```
codebaux-guest/
  build-guest.sh            # Master build runner
  scripts/
    01-fetch-v86-deps.sh    # Step 1
    02-build-base-image.sh  # Step 2
    03-apply-overlay.sh     # Step 3
    04-install-helpers.sh   # Step 4
    05-configure-init.sh    # Step 5
    06-validate-boot.sh     # Step 6
    07-integration-tests.sh # Step 7
    08-package.sh           # Step 8
  guest/
    docker/
      Dockerfile            # i386 Alpine guest image
    helpers/
      receive-project       # Sync handler (HOST_SYNC → extract)
      run-project           # Execution handler (HOST_RUN → node)
      stop-project          # Kill handler (HOST_STOP → SIGTERM)
      serial-listener       # Main daemon (reads ttyS0, dispatches)
    overlay/
      etc/
        codebaux/
          protocol.conf     # Shared protocol constants
        init.d/
          codebaux-serial   # OpenRC service definition
  dist/
    guest/                  # Build output (gitignored)
```

## Integration with Host App

After building, copy `dist/guest/` into the host app's public directory and replace the simulation mode in `V86Bridge` with real `V86Starter` calls. See `dist/guest/v86-config.js.example` for the exact configuration.
