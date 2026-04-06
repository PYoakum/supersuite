/**
 * dnsmasq DHCP server management - lifecycle, lease parsing, IP lookup
 */

import { spawn } from "../lib/utils.js";
import { readFile, unlink } from "node:fs/promises";

const PID_FILE = "/tmp/vmp-dnsmasq.pid";
const LEASE_FILE = "/tmp/vmp-dnsmasq.leases";

let dnsmasqProc = null;

/**
 * Check if dnsmasq is running via PID file
 */
export async function isDnsmasqRunning() {
  try {
    const pid = parseInt(await readFile(PID_FILE, "utf8"), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start dnsmasq for DHCP on the bridge. Idempotent.
 */
export async function startDnsmasq({ bridgeName, bridgeIp, rangeStart, rangeEnd }) {
  if (await isDnsmasqRunning()) {
    console.log("  dnsmasq already running, reusing");
    return;
  }

  // Clean up stale files
  try { await unlink(PID_FILE); } catch {}
  try { await unlink(LEASE_FILE); } catch {}

  dnsmasqProc = spawn("dnsmasq", [
    `--interface=${bridgeName}`,
    "--bind-interfaces",
    `--dhcp-range=${rangeStart},${rangeEnd},12h`,
    `--dhcp-option=option:router,${bridgeIp}`,
    `--dhcp-option=option:dns-server,${bridgeIp}`,
    "--no-resolv",
    "--server=8.8.8.8",
    "--server=1.1.1.1",
    `--pid-file=${PID_FILE}`,
    `--dhcp-leasefile=${LEASE_FILE}`,
    "--keep-in-foreground",
    "--log-dhcp",
  ]);

  // Wait briefly for dnsmasq to write PID file
  await new Promise((r) => setTimeout(r, 500));

  if (!(await isDnsmasqRunning())) {
    // Read stderr for diagnostics
    let stderr = "";
    try { stderr = await new Response(dnsmasqProc.stderr).text(); } catch {}
    throw new Error(`dnsmasq failed to start: ${stderr}`);
  }

  console.log("  dnsmasq started");
}

/**
 * Stop dnsmasq. Best-effort.
 */
export async function stopDnsmasq() {
  try {
    const pid = parseInt(await readFile(PID_FILE, "utf8"), 10);
    process.kill(pid, "SIGTERM");
  } catch {}

  if (dnsmasqProc) {
    try {
      await Promise.race([dnsmasqProc.exited, new Promise((r) => setTimeout(r, 3000))]);
    } catch {}
    dnsmasqProc = null;
  }

  try { await unlink(PID_FILE); } catch {}
  try { await unlink(LEASE_FILE); } catch {}
  console.log("  dnsmasq stopped");
}

/**
 * Parse dnsmasq lease file. Returns array of { timestamp, mac, ip, hostname, clientId }.
 * @param {string} [leaseFile] - Optional lease file path override
 */
export async function readLeases(leaseFile) {
  try {
    const text = await readFile(leaseFile || LEASE_FILE, "utf8");
    return text.trim().split("\n").filter(Boolean).map((line) => {
      const [timestamp, mac, ip, hostname, clientId] = line.split(" ");
      return { timestamp, mac: mac?.toLowerCase(), ip, hostname, clientId };
    });
  } catch {
    return [];
  }
}

/**
 * Look up an IP address by MAC from the dnsmasq lease file.
 * @param {string} mac - MAC address to look up
 * @param {string} [leaseFile] - Optional lease file path (for pool mode with external dnsmasq)
 */
export async function lookupIpByMac(mac, leaseFile) {
  if (!mac) return null;
  const leases = await readLeases(leaseFile);
  const entry = leases.find((l) => l.mac === mac.toLowerCase());
  return entry?.ip || null;
}
