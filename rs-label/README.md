# rs-label

TUI and CLI for Brother PT-D600 label printing over USB.

## Setup

```bash
cd rs-label
cargo build --release
```

Optionally copy and edit the config (defaults work if your printer is a PT-D600):

```bash
cp config.toml.example config.toml
```

### macOS permissions

USB access should work out of the box. If you get "Access denied", check System Settings > Privacy & Security.

### Linux permissions

Add a udev rule so you don't need root:

```bash
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="04f9", MODE="0666"' | sudo tee /etc/udev/rules.d/99-brother.rules
sudo udevadm control --reload-rules
```

Then unplug/replug the printer.

## CLI Usage

```bash
# Find your printer
rs-label discover

# Check printer status and loaded tape
rs-label status

# Print an image (auto-detects tape width)
rs-label print image.png

# Print with options
rs-label print image.png --threshold 160 --invert

# Send raw hex commands (e.g. status request)
rs-label raw "1B 69 53"
```

## TUI

Launch with no arguments:

```bash
rs-label
```

### Tabs (switch with 1-5 or Tab/Shift+Tab)

| # | Tab | What it does |
|---|-----|--------------|
| 1 | Dashboard | Connect to printer, view status/media info, initialize |
| 2 | Print | Browse files, preview labels, adjust threshold/invert, print |
| 3 | Raw Cmd | Send arbitrary hex bytes, view TX/RX history |
| 4 | Templates | List printer templates (read-only) |
| 5 | Logs | Scrollable operation log |

### Key bindings

**Global:** `q`/`Esc` quit, `?` help, `Ctrl+C` force quit

**Dashboard:** `c` connect, `r` refresh status, `i` initialize

**Print:** `j/k` navigate, `Enter` open dir or print, `Backspace` parent dir, `t` cycle threshold (64/96/128/160/192), `v` toggle invert

**Raw Cmd:** `i`/`Enter` start typing hex, `Enter` send, `Esc` cancel

**Logs:** `j/k` scroll, `g/G` top/bottom, `p` pause auto-scroll, `c` clear

## Config

All fields are optional with sensible defaults:

```toml
[printer]
vendor_id = 0x04F9    # Brother
product_id = 0x2074   # PT-D600
timeout_ms = 5000
image_dir = "./labels"
threshold = 128        # Black/white cutoff (0-255)
tape_width_mm = 24     # Fallback if auto-detect fails
```

The `print` command auto-detects tape width from the printer, so `tape_width_mm` is only used as a fallback.

## Supported image formats

PNG, JPEG, BMP, GIF, TIFF — anything the `image` crate supports.
