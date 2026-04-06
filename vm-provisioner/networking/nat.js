/**
 * NAT / iptables management - MASQUERADE, FORWARD rules
 */

import { exec } from "../lib/utils.js";

/**
 * Detect the default outbound network interface (e.g. eth0, ens3)
 */
export async function detectOutboundInterface() {
  const { code, stdout } = await exec("ip", ["route", "show", "default"]);
  if (code !== 0 || !stdout) throw new Error("No default route found");

  const match = stdout.match(/dev\s+(\S+)/);
  if (!match) throw new Error("Could not parse default route interface");
  return match[1];
}

/**
 * Add MASQUERADE rule for subnet traffic going out via outIface. Idempotent.
 */
export async function addMasquerade(subnet, outIface) {
  // Check if rule already exists
  const check = await exec("iptables", [
    "-t", "nat", "-C", "POSTROUTING",
    "-s", subnet, "-o", outIface, "-j", "MASQUERADE",
  ]);
  if (check.code === 0) return;

  const { code, stderr } = await exec("iptables", [
    "-t", "nat", "-A", "POSTROUTING",
    "-s", subnet, "-o", outIface, "-j", "MASQUERADE",
  ]);
  if (code !== 0) throw new Error(`Failed to add MASQUERADE rule: ${stderr}`);
  console.log(`  NAT MASQUERADE: ${subnet} -> ${outIface}`);
}

/**
 * Add FORWARD rules for bridge <-> outbound traffic. Idempotent.
 */
export async function addForwardRules(bridgeName, outIface) {
  // Allow established/related traffic back in
  const checkIn = await exec("iptables", [
    "-C", "FORWARD",
    "-i", outIface, "-o", bridgeName,
    "-m", "state", "--state", "RELATED,ESTABLISHED",
    "-j", "ACCEPT",
  ]);
  if (checkIn.code !== 0) {
    await exec("iptables", [
      "-A", "FORWARD",
      "-i", outIface, "-o", bridgeName,
      "-m", "state", "--state", "RELATED,ESTABLISHED",
      "-j", "ACCEPT",
    ]);
  }

  // Allow new outbound traffic from bridge
  const checkOut = await exec("iptables", [
    "-C", "FORWARD",
    "-i", bridgeName, "-o", outIface,
    "-j", "ACCEPT",
  ]);
  if (checkOut.code !== 0) {
    await exec("iptables", [
      "-A", "FORWARD",
      "-i", bridgeName, "-o", outIface,
      "-j", "ACCEPT",
    ]);
  }

  console.log(`  FORWARD rules: ${bridgeName} <-> ${outIface}`);
}

/**
 * Remove all NAT/FORWARD rules added by us. Best-effort.
 */
export async function removeMasquerade(subnet, outIface, bridgeName) {
  await exec("iptables", [
    "-t", "nat", "-D", "POSTROUTING",
    "-s", subnet, "-o", outIface, "-j", "MASQUERADE",
  ]);
  await exec("iptables", [
    "-D", "FORWARD",
    "-i", outIface, "-o", bridgeName,
    "-m", "state", "--state", "RELATED,ESTABLISHED",
    "-j", "ACCEPT",
  ]);
  await exec("iptables", [
    "-D", "FORWARD",
    "-i", bridgeName, "-o", outIface,
    "-j", "ACCEPT",
  ]);
  console.log("  iptables rules removed");
}
