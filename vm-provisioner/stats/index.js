/**
 * Stats loop - periodic collection and broadcast
 */

import { DEFAULTS } from "../lib/constants.js";
import { collectAll } from "./collector.js";
import { broadcast } from "../server/websocket.js";

let intervalId = null;

export function startStatsLoop(intervalMs = DEFAULTS.STATS_INTERVAL_MS) {
  if (intervalId) return;
  intervalId = setInterval(async () => {
    try {
      const stats = await collectAll();
      broadcast({ type: "stats", data: stats });
    } catch (e) {
      console.error("Stats collection error:", e.message);
    }
  }, intervalMs);
  console.log(`Stats loop started (${intervalMs}ms interval)`);
}

export function stopStatsLoop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export { collectAll, collectOne } from "./collector.js";
export { getUptimeMs, startTracking, stopTracking } from "./tracker.js";
