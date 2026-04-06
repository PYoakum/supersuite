/**
 * Service daemon management — systemd (Linux only)
 */

import { execSync } from "child_process";
import { existsSync, writeFileSync, unlinkSync } from "fs";

const SERVICE_NAME = "community-board";
const INSTALL_DIR = "/opt/community-board";
const SYSTEMD_UNIT_PATH = `/etc/systemd/system/${SERVICE_NAME}.service`;

function getBunPath() {
  try {
    return execSync("which bun", { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Could not find bun binary. Make sure bun is installed and in your PATH.");
  }
}

function requireRoot() {
  if (process.getuid() !== 0) {
    throw new Error("Service management requires root. Re-run with sudo.");
  }
}

function systemdUnit() {
  const bunPath = getBunPath();

  return `[Unit]
Description=Community Board Forum
After=network-online.target postgresql.service
Wants=network-online.target postgresql.service

[Service]
Type=simple
User=${SERVICE_NAME}
ExecStart=${bunPath} ${INSTALL_DIR}/server.js
WorkingDirectory=${INSTALL_DIR}
Environment=CONFIG_PATH=${INSTALL_DIR}/config.toml
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}

export function installService() {
  requireRoot();
  const unit = systemdUnit();
  writeFileSync(SYSTEMD_UNIT_PATH, unit);
  console.log("Wrote " + SYSTEMD_UNIT_PATH);

  execSync("systemctl daemon-reload");
  execSync(`systemctl enable ${SERVICE_NAME}`);
  execSync(`systemctl start ${SERVICE_NAME}`);
  console.log(`Service ${SERVICE_NAME} installed, enabled, and started.`);
}

export function uninstallService() {
  requireRoot();
  try { execSync(`systemctl stop ${SERVICE_NAME}`); } catch {}
  try { execSync(`systemctl disable ${SERVICE_NAME}`); } catch {}
  if (existsSync(SYSTEMD_UNIT_PATH)) {
    unlinkSync(SYSTEMD_UNIT_PATH);
    console.log("Removed " + SYSTEMD_UNIT_PATH);
  }
  execSync("systemctl daemon-reload");
  console.log(`Service ${SERVICE_NAME} uninstalled.`);
}

export function serviceStatus() {
  try {
    const out = execSync(`systemctl status ${SERVICE_NAME}`, { encoding: "utf8" });
    console.log(out);
  } catch (e) {
    console.log(e.stdout || e.message);
  }
}
