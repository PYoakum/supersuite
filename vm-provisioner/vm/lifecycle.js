/**
 * VM lifecycle orchestration - create/start/stop/destroy across backends
 */

import { generateId, timestamp } from "../lib/utils.js";
import { STATUS, DEFAULTS, BACKENDS } from "../lib/constants.js";
import { getBackend } from "../backends/index.js";
import * as registry from "./registry.js";
import { savePersistedVms, toPersistable } from "../persistence/store.js";
import { startTracking, stopTracking } from "../stats/tracker.js";
import { broadcast } from "../server/websocket.js";
import { allocateTap, releaseTap, isNetworkReady } from "../networking/index.js";

/**
 * Create a new VM entry and register it
 */
export async function createVm({ name, backend, imagePath, vcpus, memMb, persistent, tags, config }) {
  if (!name) throw new Error("name is required");
  if (!backend) throw new Error("backend is required");
  if (!Object.values(BACKENDS).includes(backend)) {
    throw new Error(`Invalid backend: ${backend}`);
  }
  if (!imagePath) throw new Error("imagePath is required");

  const id = generateId();
  const vm = {
    id,
    name,
    backend,
    imagePath,
    vcpus: vcpus || DEFAULTS.VCPUS,
    memMb: memMb || DEFAULTS.MEM_MB,
    persistent: !!persistent,
    tags: tags || [],
    config: config || {},
    status: STATUS.CREATED,
    createdAt: timestamp(),
  };

  const backendMod = getBackend(backend);
  const result = await backendMod.create(vm);
  if (!result.success) {
    throw new Error(result.error || "Backend create failed");
  }

  registry.set(id, vm);

  if (vm.persistent) {
    await persistAll();
  }

  broadcast({ type: "vm_created", data: { vmId: id, vm: toPublic(vm) } });
  return vm;
}

/**
 * Start a VM
 */
export async function startVm(id) {
  const vm = registry.get(id);
  if (!vm) throw new Error(`VM not found: ${id}`);
  if (vm.status === STATUS.RUNNING) throw new Error("VM is already running");

  vm.status = STATUS.STARTING;

  // Allocate TAP device before starting (sets vm.config.tapDevice/guestMac)
  if (isNetworkReady()) {
    await allocateTap(vm);
  }

  const backendMod = getBackend(vm.backend);
  const result = await backendMod.start(vm);

  if (!result.success) {
    vm.status = STATUS.ERROR;
    throw new Error(result.error || "Backend start failed");
  }

  vm.status = STATUS.RUNNING;
  startTracking(id);
  broadcast({ type: "vm_started", data: { vmId: id, vm: toPublic(vm) } });
  return vm;
}

/**
 * Stop a VM
 */
export async function stopVm(id) {
  const vm = registry.get(id);
  if (!vm) throw new Error(`VM not found: ${id}`);
  if (vm.status !== STATUS.RUNNING && vm.status !== STATUS.STARTING) {
    throw new Error("VM is not running");
  }

  vm.status = STATUS.STOPPING;
  const backendMod = getBackend(vm.backend);
  const result = await backendMod.stop(vm);

  if (!result.success) {
    vm.status = STATUS.ERROR;
    throw new Error(result.error || "Backend stop failed");
  }

  vm.status = STATUS.STOPPED;
  stopTracking(id);

  if (isNetworkReady()) {
    await releaseTap(vm);
  }

  broadcast({ type: "vm_stopped", data: { vmId: id, vm: toPublic(vm) } });
  return vm;
}

/**
 * Destroy and remove a VM
 */
export async function destroyVm(id) {
  const vm = registry.get(id);
  if (!vm) throw new Error(`VM not found: ${id}`);

  const backendMod = getBackend(vm.backend);

  // Stop first if running
  if (vm.status === STATUS.RUNNING || vm.status === STATUS.STARTING) {
    await backendMod.stop(vm);
    stopTracking(id);
  }

  await backendMod.destroy(vm);

  if (isNetworkReady()) {
    await releaseTap(vm);
  }

  registry.remove(id);

  if (vm.persistent) {
    await persistAll();
  }

  broadcast({ type: "vm_deleted", data: { vmId: id } });
}

/**
 * Save all persistent VMs to disk
 */
export async function persistAll() {
  const persistent = registry.filter((vm) => vm.persistent);
  await savePersistedVms(persistent.map(toPersistable));
}

/**
 * Strip runtime internals from a VM entry for API responses
 */
export function toPublic(vm) {
  if (!vm) return null;
  return {
    id: vm.id,
    name: vm.name,
    backend: vm.backend,
    imagePath: vm.imagePath,
    vcpus: vm.vcpus,
    memMb: vm.memMb,
    persistent: vm.persistent,
    tags: vm.tags || [],
    config: vm.config,
    status: vm.status,
    createdAt: vm.createdAt,
  };
}
