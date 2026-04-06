/**
 * VM CRUD REST endpoints
 */

import { jsonResponse, errorResponse } from "../middleware.js";
import * as registry from "../../vm/registry.js";
import { createVm, startVm, stopVm, destroyVm, toPublic } from "../../vm/lifecycle.js";

export async function handleListVms() {
  const vms = registry.list().map(toPublic);
  return jsonResponse({ success: true, data: vms });
}

export async function handleGetVm(id) {
  const vm = registry.get(id);
  if (!vm) return jsonResponse({ success: false, error: "VM not found" }, 404);
  return jsonResponse({ success: true, data: toPublic(vm) });
}

export async function handleCreateVm(req) {
  try {
    const body = await req.json();
    const vm = await createVm(body);
    return jsonResponse({ success: true, data: toPublic(vm) }, 201);
  } catch (e) {
    return errorResponse(e, 400);
  }
}

export async function handleStartVm(id) {
  try {
    const vm = await startVm(id);
    return jsonResponse({ success: true, data: toPublic(vm) });
  } catch (e) {
    return errorResponse(e, 400);
  }
}

export async function handleStopVm(id) {
  try {
    const vm = await stopVm(id);
    return jsonResponse({ success: true, data: toPublic(vm) });
  } catch (e) {
    return errorResponse(e, 400);
  }
}

export async function handleDestroyVm(id) {
  try {
    await destroyVm(id);
    return jsonResponse({ success: true });
  } catch (e) {
    return errorResponse(e, 400);
  }
}
