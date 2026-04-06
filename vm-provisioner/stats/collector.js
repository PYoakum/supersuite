/**
 * Stats collector - polls all running VMs via backend.getStats() in parallel
 */

import * as registry from "../vm/registry.js";
import { getBackend } from "../backends/index.js";
import { getUptimeMs } from "./tracker.js";
import { STATUS } from "../lib/constants.js";

/**
 * Collect stats for all running VMs
 * @returns {Promise<object>} { [vmId]: { status, networkRxBytes, networkTxBytes, ip, uptimeMs } }
 */
export async function collectAll() {
  const running = registry.filter(
    (vm) => vm.status === STATUS.RUNNING || vm.status === STATUS.STARTING,
  );

  const results = await Promise.all(
    running.map(async (vm) => {
      try {
        const backend = getBackend(vm.backend);
        const stats = await backend.getStats(vm);
        return {
          vmId: vm.id,
          data: {
            status: vm.status,
            networkRxBytes: stats.data?.networkRxBytes || 0,
            networkTxBytes: stats.data?.networkTxBytes || 0,
            ip: stats.data?.ip || "",
            uptimeMs: getUptimeMs(vm.id),
          },
        };
      } catch {
        return {
          vmId: vm.id,
          data: {
            status: vm.status,
            networkRxBytes: 0,
            networkTxBytes: 0,
            ip: "",
            uptimeMs: getUptimeMs(vm.id),
          },
        };
      }
    }),
  );

  const out = {};
  for (const { vmId, data } of results) {
    out[vmId] = data;
  }

  // Include stopped/created VMs with basic info
  for (const vm of registry.list()) {
    if (!out[vm.id]) {
      out[vm.id] = {
        status: vm.status,
        networkRxBytes: 0,
        networkTxBytes: 0,
        ip: "",
        uptimeMs: 0,
      };
    }
  }

  return out;
}

/**
 * Collect stats for a single VM
 */
export async function collectOne(vmId) {
  const vm = registry.get(vmId);
  if (!vm) return null;

  if (vm.status === STATUS.RUNNING || vm.status === STATUS.STARTING) {
    try {
      const backend = getBackend(vm.backend);
      const stats = await backend.getStats(vm);
      return {
        status: vm.status,
        networkRxBytes: stats.data?.networkRxBytes || 0,
        networkTxBytes: stats.data?.networkTxBytes || 0,
        ip: stats.data?.ip || "",
        uptimeMs: getUptimeMs(vmId),
      };
    } catch {}
  }

  return {
    status: vm.status,
    networkRxBytes: 0,
    networkTxBytes: 0,
    ip: "",
    uptimeMs: 0,
  };
}
