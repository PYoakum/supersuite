/**
 * In-memory VM registry - Map<id, VmEntry>
 */

/** @type {Map<string, object>} */
const vms = new Map();

export function get(id) {
  return vms.get(id) || null;
}

export function list() {
  return Array.from(vms.values());
}

export function set(id, entry) {
  vms.set(id, entry);
}

export function remove(id) {
  return vms.delete(id);
}

export function has(id) {
  return vms.has(id);
}

export function filter(fn) {
  return list().filter(fn);
}

export function byStatus(status) {
  return filter((vm) => vm.status === status);
}

export function byBackend(backend) {
  return filter((vm) => vm.backend === backend);
}
