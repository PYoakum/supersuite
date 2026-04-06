/**
 * Tag REST endpoints
 */

import { jsonResponse, errorResponse } from "../middleware.js";
import * as registry from "../../vm/registry.js";
import { persistAll, toPublic } from "../../vm/lifecycle.js";
import { broadcast } from "../websocket.js";

export async function handleListTags() {
  const tagSet = new Set();
  for (const vm of registry.list()) {
    if (vm.tags) {
      for (const tag of vm.tags) tagSet.add(tag);
    }
  }
  return jsonResponse({ success: true, data: Array.from(tagSet).sort() });
}

export async function handleSetVmTags(id, req) {
  try {
    const vm = registry.get(id);
    if (!vm) return jsonResponse({ success: false, error: "VM not found" }, 404);

    const { tags } = await req.json();
    if (!Array.isArray(tags)) {
      return jsonResponse({ success: false, error: "tags must be an array" }, 400);
    }

    vm.tags = tags.map((t) => String(t).trim()).filter(Boolean);

    if (vm.persistent) {
      await persistAll();
    }

    broadcast({ type: "vm_tags_updated", data: { vmId: id, vm: toPublic(vm) } });
    return jsonResponse({ success: true, data: toPublic(vm) });
  } catch (e) {
    return errorResponse(e, 400);
  }
}
