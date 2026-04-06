# asset-map

A dark, network-topology inventory and visualization tool.
Built with: Bun (built-in `bun:sqlite`, `Bun.serve()`), Three.js, Vanilla JS ES Modules.

---

## Requirements

- Bun v1.0+
- No build step required

---

## Quick Start

```bash
# Install dependencies (toml only)
bun install

# Start the server
bun start
# → http://localhost:3000
```

Configuration is in `config/app.toml`. The DB is auto-created at `./data/asset-map.db` on first run and seeded with sample data.

---

## Configuration

| File | Purpose |
|---|---|
| `config/app.toml` | Server port, DB path, barcode format |
| `config/theme.toml` | All colors, fonts, layout sizes |
| `config/fields.toml` | Extra fields per device category |

Change `theme.toml` to restyle the UI without touching code. Changes apply on next page reload.

---

## Manual Test Cases — Milestone A/B (API)

```bash
# Health check
curl http://localhost:3000/api/health

# List locations (seed data)
curl http://localhost:3000/api/locations

# Get devices for first location (replace ID)
LOC_ID=$(curl -s http://localhost:3000/api/locations | bun -e "process.stdin.on('data',d=>console.log(JSON.parse(d)[0].id))")
curl http://localhost:3000/api/locations/$LOC_ID/devices

# Create a new location
curl -X POST http://localhost:3000/api/locations \
  -H "Content-Type: application/json" \
  -d '{"name":"Test DC","description":"Test datacenter"}'

# Search
curl "http://localhost:3000/api/search?q=switch"
curl "http://localhost:3000/api/search?q=192.168"
```

## Manual Test Cases — UI

1. Open http://localhost:3000 → Dark UI loads, "Main Office" auto-selected
2. Three.js map renders 10 nodes in a radial layout with edges
3. Click any node → highlights blue, panel shows device details
4. Edit any field → click Save → refreshes without error
5. Click "Label" tab → QR code renders for the device
6. Type in search box → live results appear; clicking selects that node on map
7. Click "+ Location" → modal opens; create a new location
8. Click "+ Device" → fill minimal form; new node appears on map
9. Drag a node (double-click) to reposition; positions persist on reload
10. Change `config/theme.toml` accent color → reload page → color updates

---

## Architecture Notes

- **No bundler** — ES Modules loaded directly in browser
- **No framework** — Vanilla JS state + event subscriptions (`state.js`)
- **Minimal deps** — only `toml` npm package for server config parsing
- Three.js loaded from `/vendor/three.module.js` (copied from npm at install)
- SQLite via `bun:sqlite` (Bun built-in)

---

## Project Structure

```
asset-map/
  config/         TOML configuration
  server/         Bun HTTP server + API
  public/         Client-side code (ES Modules, no bundler)
    three/        Three.js scene, camera, picking, layout
    views/        Map view, management panel, search
    barcode/      QR code generator
    styles/       CSS (base + theme variables)
    vendor/       three.module.js
  data/           SQLite DB (auto-created)
```
