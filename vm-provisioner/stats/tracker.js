/**
 * Per-VM uptime tracker - Map of start timestamps
 */

/** @type {Map<string, number>} */
const startTimes = new Map();

export function startTracking(vmId) {
  startTimes.set(vmId, Date.now());
}

export function stopTracking(vmId) {
  startTimes.delete(vmId);
}

export function getUptimeMs(vmId) {
  const start = startTimes.get(vmId);
  if (!start) return 0;
  return Date.now() - start;
}

export function isTracked(vmId) {
  return startTimes.has(vmId);
}
