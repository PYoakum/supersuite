/**
 * JSON file store - only persistent VMs written to disk
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJson, saveJson } from "../lib/state.js";
import { DEFAULTS } from "../lib/constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, "..", DEFAULTS.STATE_FILE);

/**
 * Load persistent VM configs from disk
 * @returns {Promise<object[]>}
 */
export async function loadPersistedVms() {
  const data = await loadJson(STATE_PATH, { vms: [] });
  return data.vms || [];
}

/**
 * Save persistent VM configs to disk
 * @param {object[]} vmConfigs - Array of VM config objects (no runtime state)
 */
export async function savePersistedVms(vmConfigs) {
  await saveJson(STATE_PATH, { vms: vmConfigs });
}

/**
 * Extract the persistable config from a VM entry (no PIDs, sockets, etc.)
 */
export function toPersistable(vm) {
  return {
    id: vm.id,
    name: vm.name,
    backend: vm.backend,
    imagePath: vm.imagePath,
    vcpus: vm.vcpus,
    memMb: vm.memMb,
    persistent: vm.persistent,
    tags: vm.tags || [],
    config: vm.config || {},
    createdAt: vm.createdAt,
  };
}
