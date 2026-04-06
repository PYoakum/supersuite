export function buildTemplate() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Virtual Client</title>
  <style>${css}</style>
</head>
<body>
  <div id="app">
    <header>
      <h1>Virtual Client</h1>
      <div id="status-bar">
        <span id="vm-status" class="status-dot off"></span>
        <span id="vm-status-text">Stopped</span>
      </div>
    </header>

    <div id="main">
      <div id="screen-area">
        <div id="screen_container">
          <div style="white-space: pre; font: 14px monospace; line-height: 14px"></div>
          <canvas style="display: none"></canvas>
        </div>
        <div id="screen-overlay">
          <button id="btn-start-overlay">Start VM</button>
        </div>
        <button id="btn-fullscreen" title="Toggle fullscreen">Fullscreen</button>
      </div>

      <details id="controls-section" open>
        <summary>Controls</summary>
        <div id="controls">
          <div class="control-group">
            <button id="btn-start" title="Start">Start</button>
            <button id="btn-stop" disabled title="Stop">Stop</button>
            <button id="btn-reset" disabled title="Reset">Reset</button>
          </div>
          <div class="control-group">
            <button id="btn-save" disabled title="Save workspace to disk">Save to Disk</button>
          </div>
          <div class="control-group">
            <label id="capture-label">
              <input type="checkbox" id="chk-capture">
              Capture keyboard
            </label>
          </div>
        </div>
      </details>
    </div>

    <details id="images-section" open>
      <summary>VM Images</summary>
      <div id="images-list"></div>
      <div id="images-actions">
        <span id="selected-image-label">No image selected</span>
        <button id="btn-load-image" disabled>Load</button>
      </div>
    </details>

    <details id="serial-section" open>
      <summary>Serial Console</summary>
      <div id="serial-output"></div>
      <div id="serial-input-row">
        <input type="text" id="serial-input" placeholder="Type command and press Enter..." disabled>
        <button id="btn-serial-send" disabled>Send</button>
      </div>
    </details>

    <div id="save-modal" class="modal hidden">
      <div class="modal-content">
        <div id="save-progress">
          <div id="save-spinner" class="spinner"></div>
          <p id="save-message">Reading export file...</p>
        </div>
      </div>
    </div>
  </div>

  <script src="/vendor/libv86.js"></script>
  <script>${js}</script>
</body>
</html>`;
}

const css = `
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #1a1a2e;
  --bg-surface: #16213e;
  --bg-elevated: #0f3460;
  --text: #e0e0e0;
  --text-dim: #888;
  --accent: #53a8b6;
  --accent-hover: #79c7d4;
  --danger: #e94560;
  --success: #4ecca3;
  --warning: #f5a623;
  --border: #2a2a4a;
  --radius: 6px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
}

#app {
  max-width: 900px;
  margin: 0 auto;
  padding: 16px;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}

header h1 {
  font-size: 18px;
  font-weight: 600;
  color: var(--accent);
}

#status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.status-dot.off { background: var(--text-dim); }
.status-dot.booting { background: var(--warning); animation: pulse 1s infinite; }
.status-dot.running { background: var(--success); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

#main {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

#screen-area {
  position: relative;
  background: #000;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
}

#screen_container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

#screen_container canvas {
  width: 100%;
  image-rendering: pixelated;
}

#screen_container > div {
  padding: 4px;
  color: #aaa;
}

#screen-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  z-index: 10;
}

#screen-overlay.hidden { display: none; }

#btn-start-overlay {
  padding: 16px 48px;
  font-size: 20px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background 0.2s;
}
#btn-start-overlay:hover { background: var(--accent-hover); }

#controls-section,
#images-section,
#serial-section {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-surface);
}

#images-section,
#serial-section {
  margin-top: 16px;
}

#controls-section summary,
#images-section summary,
#serial-section summary {
  padding: 10px 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  user-select: none;
}

#controls {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
}

.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

button {
  padding: 8px 16px;
  font-size: 13px;
  background: var(--bg-elevated);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
button:hover:not(:disabled) {
  background: var(--accent);
  border-color: var(--accent);
}
button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

#btn-save {
  background: var(--bg-elevated);
  border-color: var(--success);
  color: var(--success);
}
#btn-save:hover:not(:disabled) {
  background: var(--success);
  color: #fff;
}

#capture-label {
  font-size: 13px;
  color: var(--text-dim);
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}

#serial-output {
  height: 200px;
  overflow-y: auto;
  padding: 8px 14px;
  font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  color: #c8d6e5;
  background: #0d1117;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

#serial-input-row {
  display: flex;
  gap: 8px;
  padding: 8px 14px;
}

#serial-input {
  flex: 1;
  padding: 6px 10px;
  font-family: monospace;
  font-size: 12px;
  background: #0d1117;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  outline: none;
}
#serial-input:focus { border-color: var(--accent); }
#serial-input:disabled { opacity: 0.4; }

#images-list {
  border-top: 1px solid var(--border);
  max-height: 200px;
  overflow-y: auto;
}

.image-item {
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}
.image-item:last-child { border-bottom: none; }
.image-item:hover { background: var(--bg-elevated); }
.image-item.selected { background: var(--bg-elevated); border-left: 3px solid var(--accent); }
.image-item.current { color: var(--success); }
.image-item .image-type {
  font-size: 11px;
  color: var(--text-dim);
  background: var(--bg);
  padding: 2px 8px;
  border-radius: 3px;
}

#images-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-dim);
}

#btn-fullscreen {
  position: absolute;
  bottom: 8px;
  right: 8px;
  z-index: 5;
  padding: 6px 12px;
  font-size: 12px;
  opacity: 0;
  transition: opacity 0.2s;
  background: rgba(15, 52, 96, 0.85);
  border: 1px solid var(--border);
}
#screen-area:hover #btn-fullscreen,
#screen-area:fullscreen #btn-fullscreen {
  opacity: 1;
}

#screen-area:fullscreen {
  background: #000;
  width: 100vw;
  height: 100vh;
}
#screen-area:fullscreen #screen_container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
#screen-area:fullscreen #screen_container canvas {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal.hidden { display: none; }

.modal-content {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 32px 40px;
  text-align: center;
  max-width: 420px;
}

#save-progress { display: flex; flex-direction: column; align-items: center; gap: 16px; }

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

#save-message { font-size: 14px; color: var(--text-dim); }
`;

const js = `
(function() {
  "use strict";

  // ======================== STATE ========================
  let emulator = null;
  let vmState = "stopped"; // stopped | booting | running
  let serialBuffer = "";
  let selectedImage = null;
  let currentImage = { name: "v86-linux.iso", type: "cdrom" };

  // ======================== DOM ========================
  const $ = (s) => document.querySelector(s);
  const screenContainer = $("#screen_container");
  const overlay = $("#screen-overlay");
  const btnStartOverlay = $("#btn-start-overlay");
  const btnStart = $("#btn-start");
  const btnStop = $("#btn-stop");
  const btnReset = $("#btn-reset");
  const btnSave = $("#btn-save");
  const chkCapture = $("#chk-capture");
  const serialOutput = $("#serial-output");
  const serialInput = $("#serial-input");
  const btnSerialSend = $("#btn-serial-send");
  const statusDot = $("#vm-status");
  const statusText = $("#vm-status-text");
  const saveModal = $("#save-modal");
  const saveMessage = $("#save-message");
  const imagesList = $("#images-list");
  const selectedImageLabel = $("#selected-image-label");
  const btnLoadImage = $("#btn-load-image");
  const btnFullscreen = $("#btn-fullscreen");

  // ======================== VM INIT ========================
  function createEmulatorWithImage(img) {
    const config = {
      wasm_path: "/vendor/v86.wasm",
      memory_size: 64 * 1024 * 1024,
      vga_memory_size: 8 * 1024 * 1024,
      screen_container: screenContainer,
      bios: { url: "/vendor/seabios.bin" },
      vga_bios: { url: "/vendor/vgabios.bin" },
      autostart: true,
      filesystem: {},
    };

    if (img.type === "cdrom") {
      config.cdrom = { url: "/images/" + img.name };
    } else if (img.type === "fda") {
      config.fda = { url: "/images/" + img.name };
    } else if (img.type === "hda") {
      config.hda = { url: "/images/" + img.name, async: true };
    } else {
      config.bzimage = { url: "/images/" + img.name };
    }

    emulator = new V86(config);

    emulator.add_listener("emulator-ready", () => {
      setVmState("running");
    });

    emulator.add_listener("serial0-output-byte", (byte) => {
      const ch = String.fromCharCode(byte);
      serialBuffer += ch;
      if (ch === "\\n" || serialBuffer.length > 512) {
        flushSerial();
      }
    });
  }

  function createEmulator() {
    createEmulatorWithImage(currentImage);
  }

  function flushSerial() {
    if (!serialBuffer) return;
    const el = serialOutput;
    el.textContent += serialBuffer;
    serialBuffer = "";
    el.scrollTop = el.scrollHeight;
  }

  // ======================== STATE MANAGEMENT ========================
  function setVmState(state) {
    vmState = state;
    statusDot.className = "status-dot " + (state === "stopped" ? "off" : state === "booting" ? "booting" : "running");
    statusText.textContent = state === "stopped" ? "Stopped" : state === "booting" ? "Booting..." : "Running";

    const isRunning = state === "running";
    const isOff = state === "stopped";

    btnStart.disabled = !isOff;
    btnStop.disabled = isOff;
    btnReset.disabled = isOff;
    btnSave.disabled = isOff;
    serialInput.disabled = !isRunning;
    btnSerialSend.disabled = !isRunning;
    overlay.classList.toggle("hidden", !isOff);
  }

  // ======================== CONTROLS ========================
  function startVm() {
    if (emulator) {
      emulator.run();
      setVmState("booting");
    } else {
      setVmState("booting");
      createEmulator();
    }
  }

  function stopVm() {
    if (!emulator) return;
    emulator.stop();
    flushSerial();
    setVmState("stopped");
  }

  function resetVm() {
    if (!emulator) return;
    emulator.restart();
    serialOutput.textContent = "";
    serialBuffer = "";
    setVmState("booting");
  }

  // ======================== SERIAL ========================
  function sendSerial() {
    const cmd = serialInput.value;
    if (!cmd || !emulator || vmState !== "running") return;
    emulator.serial0_send(cmd + "\\n");
    serialInput.value = "";
  }

  // ======================== SAVE TO DISK ========================
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function saveToDisk() {
    if (!emulator || vmState !== "running") return;
    saveModal.classList.remove("hidden");

    // Step 1: send tar command to the VM via serial
    saveMessage.textContent = "Packaging workspace in VM...";
    emulator.serial0_send("mkdir -p /mnt/export && tar cf /mnt/export/workspace.tar /root 2>/dev/null; echo EXPORT_DONE\\n");

    // Step 2: wait for the command to finish (watch serial output for marker)
    let found = false;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await sleep(500);
      if (serialOutput.textContent.includes("EXPORT_DONE")) {
        found = true;
        break;
      }
    }

    if (!found) {
      saveMessage.textContent = "Timed out waiting for export. Trying to read anyway...";
      await sleep(500);
    }

    // Step 3: read the file from 9p
    saveMessage.textContent = "Reading export file from 9p...";
    try {
      const bytes = await emulator.read_file("/export/workspace.tar");

      const now = new Date();
      const ts = now.toISOString().replace(/[T:]/g, "-").slice(0, 16);
      const filename = "workspace-" + ts + ".tar";

      const blob = new Blob([bytes], { type: "application/x-tar" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      saveMessage.textContent = "Download started: " + filename;
      setTimeout(() => saveModal.classList.add("hidden"), 1500);

    } catch (err) {
      console.error("read_file failed:", err);
      // Try browser-side create_file to verify 9p works at all
      let diagnostic = "";
      try {
        await emulator.create_file("/diag-test.txt", new Uint8Array([116, 101, 115, 116]));
        const rb = await emulator.read_file("/diag-test.txt");
        diagnostic = "9p browser API works (read/write OK). Guest may not have written the tar to the 9p mount.";
      } catch (e2) {
        diagnostic = "9p browser API also failed: " + e2.message + ". The 9p filesystem may not be initialized.";
      }

      saveMessage.innerHTML =
        '<strong style="color: var(--warning)">Export failed</strong>' +
        '<p style="margin-top: 12px; font-size: 13px; text-align: left; color: var(--text)">' +
        'Could not read <code>/export/workspace.tar</code> from the 9p filesystem.<br><br>' +
        '<strong>Diagnostic:</strong> ' + diagnostic + '<br><br>' +
        'You can also try manually in the VM terminal:<br>' +
        '<code style="background: #0d1117; padding: 8px; display: block; border-radius: 4px; font-size: 12px; margin-top: 4px;">' +
        'ls /mnt<br>' +
        'mount | grep 9p<br>' +
        'mkdir -p /mnt/export<br>' +
        'tar cf /mnt/export/workspace.tar /root</code></p>' +
        '<button onclick="document.getElementById(\\'save-modal\\').classList.add(\\'hidden\\')" ' +
        'style="margin-top: 16px; padding: 8px 24px;">OK</button>';
    }
  }

  // ======================== IMAGE MANAGEMENT ========================
  async function fetchImages() {
    try {
      const res = await fetch("/api/images");
      const images = await res.json();
      renderImages(images);
    } catch (err) {
      console.error("Failed to fetch images:", err);
    }
  }

  function renderImages(images) {
    imagesList.innerHTML = "";
    images.forEach((img) => {
      const item = document.createElement("div");
      item.className = "image-item";
      if (currentImage && img.name === currentImage.name) {
        item.classList.add("current");
      }
      item.innerHTML =
        '<span class="image-name">' + img.name + '</span>' +
        '<span class="image-type">' + img.type + '</span>';
      item.addEventListener("click", () => selectImage(img));
      imagesList.appendChild(item);
    });
  }

  function selectImage(img) {
    selectedImage = img;
    selectedImageLabel.textContent = img.name;
    btnLoadImage.disabled = (img.name === currentImage.name);
    imagesList.querySelectorAll(".image-item").forEach((el) => {
      const name = el.querySelector(".image-name").textContent;
      el.classList.toggle("selected", name === img.name);
    });
  }

  async function loadSelectedImage() {
    if (!selectedImage || selectedImage.name === currentImage.name) return;
    if (emulator) {
      emulator.destroy();
      emulator = null;
    }
    serialOutput.textContent = "";
    serialBuffer = "";
    currentImage = selectedImage;
    setVmState("booting");
    createEmulatorWithImage(currentImage);
    fetchImages();
  }

  // ======================== FULLSCREEN ========================
  function toggleFullscreen() {
    const el = document.getElementById("screen-area");
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  }

  function onFullscreenChange() {
    btnFullscreen.textContent = document.fullscreenElement ? "Exit Fullscreen" : "Fullscreen";
  }

  // ======================== KEYBOARD CAPTURE ========================
  function updateCapture() {
    if (chkCapture.checked) {
      screenContainer.addEventListener("click", grabPointer);
    } else {
      screenContainer.removeEventListener("click", grabPointer);
      if (document.pointerLockElement === screenContainer) {
        document.exitPointerLock();
      }
    }
  }

  function grabPointer() {
    screenContainer.requestPointerLock();
  }

  // ======================== EVENT BINDINGS ========================
  btnStartOverlay.addEventListener("click", startVm);
  btnStart.addEventListener("click", startVm);
  btnStop.addEventListener("click", stopVm);
  btnReset.addEventListener("click", resetVm);
  btnSave.addEventListener("click", saveToDisk);
  chkCapture.addEventListener("change", updateCapture);

  serialInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendSerial();
  });
  btnSerialSend.addEventListener("click", sendSerial);

  btnLoadImage.addEventListener("click", loadSelectedImage);
  btnFullscreen.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", onFullscreenChange);

  // Periodic serial flush
  setInterval(flushSerial, 100);

  // Init
  setVmState("stopped");
  fetchImages();
})();
`;
