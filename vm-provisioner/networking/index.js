/**
 * Networking orchestrator - bridge, TAP, DHCP, NAT lifecycle
 *
 * Two modes:
 *   Pool mode — external config file exists (written by setup-network.sh).
 *     TAPs are pre-allocated; server runs fully unprivileged.
 *   Privileged mode — no config file. Server creates/destroys infra directly (requires root).
 */

import { readFile } from "node:fs/promises";
import { DEFAULTS, BACKENDS } from "../lib/constants.js";
import { createBridge, enableIpForwarding, destroyBridge } from "./bridge.js";
import { createTap, deleteTap } from "./tap.js";
import { startDnsmasq, stopDnsmasq, lookupIpByMac } from "./dhcp.js";
import { detectOutboundInterface, addMasquerade, addForwardRules, removeMasquerade } from "./nat.js";

/** Active TAP allocations: vmId -> { tapDevice, mac } */
const allocations = new Map();

let networkConfig = null;
let initialized = false;

/** Pool mode state */
let externalMode = false;
let tapPool = [];          // [{ name, mac, inUse: false }, ...]
let externalLeaseFile = null;

/**
 * Try loading an external network config written by setup-network.sh.
 * Returns the parsed config or null.
 */
async function loadExternalConfig(configPath) {
  try {
    const raw = await readFile(configPath, "utf8");
    const config = JSON.parse(raw);
    if (!config.taps || !Array.isArray(config.taps) || config.taps.length === 0) {
      return null;
    }
    return config;
  } catch {
    return null;
  }
}

/**
 * Initialize the full networking stack. Non-fatal on failure.
 */
export async function initNetwork(opts = {}) {
  const configPath = opts.configPath || DEFAULTS.NETWORK_CONFIG_PATH;

  // Try pool mode first
  const extConfig = await loadExternalConfig(configPath);
  if (extConfig) {
    tapPool = extConfig.taps.map((t) => ({ name: t.name, mac: t.mac, inUse: false }));
    externalLeaseFile = extConfig.leaseFile || null;
    networkConfig = {
      bridgeName: extConfig.bridgeName,
      subnet: extConfig.subnet,
      bridgeIp: extConfig.bridgeIp,
    };
    externalMode = true;
    initialized = true;

    console.log("Networking: using external network config");
    console.log(`  Config: ${configPath}`);
    console.log(`  Bridge: ${extConfig.bridgeName}`);
    console.log(`  TAP pool: ${tapPool.length} devices`);
    return;
  }

  // Fall through to privileged mode
  const bridgeName = opts.bridgeName || DEFAULTS.BRIDGE_NAME;
  const subnet = opts.subnet || DEFAULTS.SUBNET;
  const bridgeIp = opts.bridgeIp || DEFAULTS.BRIDGE_IP;
  const rangeStart = opts.rangeStart || DEFAULTS.DHCP_RANGE_START;
  const rangeEnd = opts.rangeEnd || DEFAULTS.DHCP_RANGE_END;

  // CIDR for bridge address assignment
  const mask = subnet.split("/")[1] || "24";
  const bridgeCidr = `${bridgeIp}/${mask}`;

  try {
    console.log("Networking: initializing...");

    await createBridge(bridgeName, bridgeCidr);
    await enableIpForwarding();

    const outIface = await detectOutboundInterface();
    await addMasquerade(subnet, outIface);
    await addForwardRules(bridgeName, outIface);
    await startDnsmasq({ bridgeName, bridgeIp, rangeStart, rangeEnd });

    networkConfig = { bridgeName, subnet, bridgeIp, rangeStart, rangeEnd, outIface };
    initialized = true;

    console.log("Networking: ready");
    console.log(`  Bridge: ${bridgeName} (${bridgeCidr})`);
    console.log(`  DHCP: ${rangeStart} - ${rangeEnd}`);
    console.log(`  NAT: ${subnet} -> ${outIface}`);
  } catch (e) {
    console.error(`Networking: init failed - ${e.message}`);
    console.error("  Server will continue without managed networking");
  }
}

/**
 * Allocate a TAP device for a VM. Sets vm.config.tapDevice and vm.config.guestMac.
 * Skips docker-compose VMs. Non-fatal on failure.
 */
export async function allocateTap(vm) {
  if (vm.backend === BACKENDS.DOCKER_COMPOSE) return;

  if (externalMode) {
    // Pool mode: find first available TAP
    const slot = tapPool.find((t) => !t.inUse);
    if (!slot) {
      console.warn(`Networking: TAP pool exhausted (${tapPool.length} devices in use), ${vm.id} will start without networking`);
      return;
    }

    slot.inUse = true;
    allocations.set(vm.id, { tapDevice: slot.name, mac: slot.mac });

    vm._tapDevice = slot.name;
    vm._mac = slot.mac;
    vm.config.tapDevice = slot.name;
    vm.config.guestMac = slot.mac;
    return;
  }

  // Privileged mode
  try {
    const { tapDevice, mac } = await createTap(vm.id, networkConfig.bridgeName);
    allocations.set(vm.id, { tapDevice, mac });

    vm._tapDevice = tapDevice;
    vm._mac = mac;
    vm.config.tapDevice = tapDevice;
    vm.config.guestMac = mac;
  } catch (e) {
    console.warn(`Networking: TAP allocation failed for ${vm.id} - ${e.message}`);
  }
}

/**
 * Release a TAP device for a VM. Best-effort.
 */
export async function releaseTap(vm) {
  if (externalMode) {
    // Pool mode: mark TAP as available (don't delete the device)
    const alloc = allocations.get(vm.id);
    if (alloc) {
      const slot = tapPool.find((t) => t.name === alloc.tapDevice);
      if (slot) slot.inUse = false;
    }
    allocations.delete(vm.id);
    return;
  }

  // Privileged mode
  try {
    await deleteTap(vm.id);
  } catch {}
  allocations.delete(vm.id);
}

/**
 * Look up a VM's IP from the DHCP lease file.
 */
export async function lookupVmIp(vm) {
  return lookupIpByMac(vm._mac, externalLeaseFile);
}

/**
 * Shut down the full networking stack. Best-effort.
 */
export async function shutdownNetwork() {
  if (!initialized) return;

  if (externalMode) {
    // Pool mode: just clear allocations, don't touch infrastructure
    console.log("Networking: clearing TAP allocations (external infra left intact)");
    for (const slot of tapPool) slot.inUse = false;
    allocations.clear();
    initialized = false;
    externalMode = false;
    tapPool = [];
    networkConfig = null;
    return;
  }

  // Privileged mode: full teardown
  console.log("Networking: shutting down...");

  await stopDnsmasq();

  // Delete remaining TAP devices
  for (const [vmId] of allocations) {
    try { await deleteTap(vmId); } catch {}
  }
  allocations.clear();

  if (networkConfig) {
    await removeMasquerade(networkConfig.subnet, networkConfig.outIface, networkConfig.bridgeName);
    await destroyBridge(networkConfig.bridgeName);
  }

  initialized = false;
  networkConfig = null;
  console.log("Networking: shutdown complete");
}

/**
 * Whether the networking stack is initialized and ready
 */
export function isNetworkReady() {
  return initialized;
}
