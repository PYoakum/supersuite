/**
 * Recovery - reload configs, reconstruct sockets, probe isRunning
 */

import { STATUS } from "../lib/constants.js";
import { getBackend } from "../backends/index.js";
import { SOCKET_PATHS } from "../lib/constants.js";
import * as registry from "../vm/registry.js";
import { loadPersistedVms } from "./store.js";
import { startTracking } from "../stats/tracker.js";
import { allocateTap, isNetworkReady } from "../networking/index.js";

/**
 * Recover persistent VMs from disk on startup
 */
export async function recoverVms() {
  const saved = await loadPersistedVms();
  if (!saved.length) return;

  console.log(`Recovering ${saved.length} persistent VM(s)...`);

  for (const config of saved) {
    const vm = {
      ...config,
      status: STATUS.STOPPED,
    };

    // Reconstruct socket paths from ID convention
    if (SOCKET_PATHS[vm.backend]) {
      vm._socketPath = SOCKET_PATHS[vm.backend](vm.id);
    }

    // Probe if still running
    try {
      const backend = getBackend(vm.backend);
      const running = await backend.isRunning(vm);
      if (running) {
        vm.status = STATUS.RUNNING;
        if (isNetworkReady()) {
          await allocateTap(vm);
        }
        startTracking(vm.id);
        console.log(`  ${vm.name} (${vm.id}): running`);
      } else {
        console.log(`  ${vm.name} (${vm.id}): stopped`);
      }
    } catch (e) {
      console.log(`  ${vm.name} (${vm.id}): probe failed - ${e.message}`);
    }

    registry.set(vm.id, vm);
  }
}
