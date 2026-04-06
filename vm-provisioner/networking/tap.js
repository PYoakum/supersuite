/**
 * TAP device management - create/delete TAP devices, MAC generation
 */

import { createHash } from "node:crypto";
import { exec } from "../lib/utils.js";
import { interfaceExists } from "./bridge.js";

/**
 * Generate a TAP device name from a VM ID.
 * Fits Linux IFNAMSIZ (15 chars): "vmp-" + first 8 chars of vmId.
 */
export function tapName(vmId) {
  return "vmp-" + vmId.slice(0, 8);
}

/**
 * Generate a deterministic MAC address from a VM ID.
 * Uses 52:54:00 (QEMU/KVM locally-administered OUI) + 3 bytes from SHA-256.
 */
export function generateMac(vmId) {
  const hash = createHash("sha256").update(vmId).digest();
  return `52:54:00:${hash[0].toString(16).padStart(2, "0")}:${hash[1].toString(16).padStart(2, "0")}:${hash[2].toString(16).padStart(2, "0")}`;
}

/**
 * Create a TAP device and attach it to the bridge. Idempotent.
 * Returns { tapDevice, mac }.
 */
export async function createTap(vmId, bridgeName) {
  const tap = tapName(vmId);
  const mac = generateMac(vmId);

  if (!(await interfaceExists(tap))) {
    let result = await exec("ip", ["tuntap", "add", "dev", tap, "mode", "tap"]);
    if (result.code !== 0) throw new Error(`Failed to create TAP ${tap}: ${result.stderr}`);

    result = await exec("ip", ["link", "set", tap, "master", bridgeName]);
    if (result.code !== 0) throw new Error(`Failed to attach TAP to bridge: ${result.stderr}`);

    result = await exec("ip", ["link", "set", tap, "up"]);
    if (result.code !== 0) throw new Error(`Failed to bring up TAP: ${result.stderr}`);
  }

  return { tapDevice: tap, mac };
}

/**
 * Delete a TAP device. Best-effort.
 */
export async function deleteTap(vmId) {
  const tap = tapName(vmId);
  if (!(await interfaceExists(tap))) return;
  await exec("ip", ["link", "set", tap, "down"]);
  await exec("ip", ["tuntap", "del", "dev", tap, "mode", "tap"]);
}
