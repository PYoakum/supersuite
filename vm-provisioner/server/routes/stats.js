/**
 * Stats snapshot REST endpoint
 */

import { jsonResponse } from "../middleware.js";
import { collectAll, collectOne } from "../../stats/collector.js";

export async function handleAllStats() {
  const stats = await collectAll();
  return jsonResponse({ success: true, data: stats });
}

export async function handleVmStats(id) {
  const stats = await collectOne(id);
  if (!stats) return jsonResponse({ success: false, error: "VM not found" }, 404);
  return jsonResponse({ success: true, data: stats });
}
