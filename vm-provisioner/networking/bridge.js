/**
 * Bridge device management - create/teardown bridge, IP forwarding
 */

import { exec } from "../lib/utils.js";

/**
 * Check if a network interface exists
 */
export async function interfaceExists(name) {
  const { code } = await exec("ip", ["link", "show", name]);
  return code === 0;
}

/**
 * Create a bridge device with the given CIDR. Idempotent.
 */
export async function createBridge(name, cidr) {
  if (await interfaceExists(name)) {
    console.log(`  Bridge ${name} already exists, reusing`);
    return;
  }

  let result = await exec("ip", ["link", "add", name, "type", "bridge"]);
  if (result.code !== 0) throw new Error(`Failed to create bridge: ${result.stderr}`);

  result = await exec("ip", ["addr", "add", cidr, "dev", name]);
  if (result.code !== 0 && !result.stderr.includes("RTNETLINK answers: File exists")) {
    throw new Error(`Failed to assign address to bridge: ${result.stderr}`);
  }

  result = await exec("ip", ["link", "set", name, "up"]);
  if (result.code !== 0) throw new Error(`Failed to bring up bridge: ${result.stderr}`);

  console.log(`  Bridge ${name} created with ${cidr}`);
}

/**
 * Enable IPv4 forwarding if not already enabled
 */
export async function enableIpForwarding() {
  const { stdout } = await exec("cat", ["/proc/sys/net/ipv4/ip_forward"]);
  if (stdout.trim() === "1") return;

  const { code, stderr } = await exec("sysctl", ["-w", "net.ipv4.ip_forward=1"]);
  if (code !== 0) throw new Error(`Failed to enable IP forwarding: ${stderr}`);
  console.log("  IP forwarding enabled");
}

/**
 * Tear down a bridge device. Best-effort.
 */
export async function destroyBridge(name) {
  if (!(await interfaceExists(name))) return;
  await exec("ip", ["link", "set", name, "down"]);
  await exec("ip", ["link", "delete", name]);
  console.log(`  Bridge ${name} destroyed`);
}
