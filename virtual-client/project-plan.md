Got it — Strategy B means: **the browser hosts a 9p (virtio) shared filesystem**, the guest mounts it (e.g. at `/mnt/9p`), and **Save to disk** exports (downloads) whatever the guest wrote into that shared area.

Below is an LLM-executable project plan tailored to that approach, using **Bun** for dev/build and **v86** for the in-browser VM.

---

## Core approach (Strategy B, concretely)

### Shared folder mechanism

v86 supports a **9p filesystem over virtio**. In the guest you mount it with tag `host9p` (that’s the device tag used by v86 docs) and a typical mount command is:
`mount -t 9p -o trans=virtio,version=9p2000.L host9p /mnt/9p/` ([GitHub][1])

On the browser side, v86 can expose a 9p filesystem in multiple ways; the simplest is the **JSON/HTTP filesystem** mode (it backs 9p with an in-memory FS in JS, optionally seeded from a JSON index and blobs). ([GitHub][1])

### Export (“Save to disk”) mechanism

The public v86 API includes:

* `read_file(path)` → read bytes from the 9p filesystem
* `create_file(path, data)` → write bytes into the 9p filesystem ([GitHub][2])

To export a *folder* you need a file listing. Since the public API doesn’t include `read_dir`, the most robust UX is:

**Guest produces a single export artifact** in the shared folder, e.g.

* `/mnt/9p/export/workspace.tar`
* or `/mnt/9p/export/workspace.zip`

Then the browser “Save to disk” button:

1. reads that one file via `read_file()`
2. triggers a download

This keeps the host side simple and avoids needing directory enumeration from JS.

---

## Milestones

### Milestone 1 — Bun app + v86 boots

**Deliverables**

* Bun dev server + build pipeline
* Minimal UI: VM screen, Start/Stop/Reset, Save
* v86 boots a Linux guest image reliably

**Acceptance**

* VM boots to a shell/desktop without reload
* Start/Stop/Reset works

(You’ll also include v86 assets: `v86.wasm`, BIOS files, etc.)

---

### Milestone 2 — Shared folder wiring (9p) + guest mount

**Browser-side tasks**

1. Initialize v86 with `filesystem` options (JSON/HTTP filesystem mode):

   * Optionally seed with a tiny base FS that includes `/export/.keep` and a helper script (see next milestone) ([GitHub][1])
2. Add logging listeners for v86 events (especially 9p events and download progress).

**Guest-side tasks**

1. Ensure guest kernel supports 9p virtio and 9p filesystem.

   * v86 docs list kernel config flags for building a Linux image with 9p support (e.g. `CONFIG_NET_9P`, `CONFIG_NET_9P_VIRTIO`, `CONFIG_9P_FS`, etc.). ([GitHub][3])
2. Add a boot-time step or manual instruction to mount:

   * `mount -t 9p -o trans=virtio,version=9p2000.L host9p /mnt/9p/` ([GitHub][1])

**Acceptance**

* Inside the guest: `/mnt/9p` is mounted and writable
* Creating a file in `/mnt/9p` from the guest can be read back from the browser via `read_file()`

---

### Milestone 3 — The “Save to disk” UX (single export artifact)

This milestone defines the product’s main workflow.

**Workflow (recommended)**

* User works normally in VM
* When they want persistence, they run a guest helper command that creates an export artifact in `/mnt/9p/export/…`
* They click **Save to disk** in the browser to download it

**Guest-side tasks**

1. Provide a helper command, e.g. `save-workspace`, that:

   * packages a known directory (e.g. `/home/user/work`) into `/mnt/9p/export/workspace.tar`
   * optionally writes `/mnt/9p/export/manifest.json` containing metadata (timestamp, sizes)
2. Put this helper in the guest image, or inject it into the 9p base FS and copy it into place on first boot.

**Browser-side tasks**

1. Implement Save:

   * Attempt to read `/export/workspace.tar` (or whichever fixed path you choose) via `emulator.read_file("/export/workspace.tar")` ([GitHub][2])
   * If missing: show a clear message telling user to run `save-workspace` inside the VM
2. Trigger download (Blob + `<a download>`).
3. Add a small status/progress UI (reading large files can take time).

**Acceptance**

* If `/mnt/9p/export/workspace.tar` exists, clicking Save downloads it
* If it doesn’t exist, the UI explains exactly what to do in the guest to generate it

---

### Milestone 4 — Polish + guardrails

**Tasks**

* Keyboard/mouse capture UX
* “Export ready” indicator:

  * optionally check existence by reading `/export/manifest.json` first
* Make Save resilient:

  * handle large files
  * handle VM paused/stopped (Save can still work if the file already exists)
* README instructions for users:

  * how to mount 9p
  * how to run `save-workspace`
  * what exactly “Save to disk” downloads

**Acceptance**

* A non-technical user can follow README to export their work successfully

---

## Guest OS choice (practical recommendation)

Use a lightweight Linux guest where you control the image:

* Buildroot-based or Alpine i386-style images tend to be easiest for v86.
* Ensure the kernel includes 9p virtio support (v86 doc config list). ([GitHub][3])

If you want the least friction, start from an existing v86 Linux demo image known to work, then add:

* the 9p mount step
* the `save-workspace` helper

---

## Concrete technical spec to hand to an LLM

### Fixed paths (make this explicit)

* Guest mountpoint: `/mnt/9p`
* Host-visible export dir: `/export` (in the 9p FS)
* Export artifact: `/export/workspace.tar`
* Optional metadata: `/export/manifest.json`

### Browser: v86 init (key options)

* Provide `filesystem: { basefs, baseurl }` (or omit to start empty) ([GitHub][1])
* Provide the normal v86 boot assets (bios, vgabios, disk/kernel image)

### Browser: export implementation

* `const bytes = await emulator.read_file("/export/workspace.tar")` ([GitHub][2])
* download as `workspace-YYYY-MM-DD-HHMM.tar`

---

## “LLM execution prompts” (ready to run)

**Prompt A — scaffold**

> Create a Bun-based web app that serves a static frontend and boots v86 in the browser. Include components: VmView, Controls (Start/Stop/Reset/Save), StatusBar. Add placeholders for v86 assets under public/v86.

**Prompt B — shared folder**

> Add v86 initialization with the v86 `filesystem` option (9p JSON/HTTP filesystem mode). Ensure the guest can mount `host9p` at `/mnt/9p` using `mount -t 9p -o trans=virtio,version=9p2000.L host9p /mnt/9p`. Add a simple “smoke test” button that reads `/export/hello.txt` via `read_file` and shows it.

**Prompt C — Save to disk**

> Implement Save to disk: download `/export/workspace.tar` by calling `read_file`. If missing, show a helpful message instructing user to run `save-workspace` in the guest to generate it. Include a Blob download utility and progress UI.

**Prompt D — guest helper**

> Provide a guest-side script `save-workspace` that tars a known directory into `/mnt/9p/export/workspace.tar` and writes `/mnt/9p/export/manifest.json`. Provide clear instructions for installing it into the guest image.

---

If you want, I can also pin down a “default” guest workflow (what directory counts as “the workspace”, what user account, and whether export should be `.tar` or `.zip`) and write the exact README steps to match it.

[1]: https://raw.githubusercontent.com/copy/v86/master/docs/filesystem.md "raw.githubusercontent.com"
[2]: https://raw.githubusercontent.com/copy/v86/master/v86.d.ts "raw.githubusercontent.com"
[3]: https://raw.githubusercontent.com/copy/v86/master/docs/linux-9p-image.md "raw.githubusercontent.com"
