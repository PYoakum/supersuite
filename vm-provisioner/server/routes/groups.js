/**
 * Group CRUD and bulk lifecycle REST endpoints
 */

import { jsonResponse, errorResponse } from "../middleware.js";
import * as registry from "../../vm/registry.js";
import { createVm, startVm, stopVm, destroyVm, toPublic } from "../../vm/lifecycle.js";
import { STATUS } from "../../lib/constants.js";
import {
  getGroups,
  addGroup,
  removeGroup,
  updateGroup,
  addVmsToGroup,
  removeVmsFromGroup,
} from "../../persistence/groups.js";

export async function handleListGroups() {
  return jsonResponse({ success: true, data: getGroups() });
}

export async function handleCreateGroup(req) {
  try {
    const { name, color } = await req.json();
    if (!name) return jsonResponse({ success: false, error: "name is required" }, 400);
    const group = await addGroup(name, color);
    return jsonResponse({ success: true, data: group }, 201);
  } catch (e) {
    return errorResponse(e, 400);
  }
}

export async function handleUpdateGroup(id, req) {
  try {
    const updates = await req.json();
    const group = await updateGroup(id, updates);
    return jsonResponse({ success: true, data: group });
  } catch (e) {
    return errorResponse(e, 400);
  }
}

export async function handleDeleteGroup(id) {
  try {
    await removeGroup(id);
    return jsonResponse({ success: true });
  } catch (e) {
    return errorResponse(e, 400);
  }
}

export async function handleAddVmsToGroup(id, req) {
  try {
    const { vmIds } = await req.json();
    if (!vmIds || !Array.isArray(vmIds)) {
      return jsonResponse({ success: false, error: "vmIds array is required" }, 400);
    }
    const group = await addVmsToGroup(id, vmIds);
    return jsonResponse({ success: true, data: group });
  } catch (e) {
    return errorResponse(e, 400);
  }
}

export async function handleRemoveVmsFromGroup(id, req) {
  try {
    const { vmIds } = await req.json();
    if (!vmIds || !Array.isArray(vmIds)) {
      return jsonResponse({ success: false, error: "vmIds array is required" }, 400);
    }
    const group = await removeVmsFromGroup(id, vmIds);
    return jsonResponse({ success: true, data: group });
  } catch (e) {
    return errorResponse(e, 400);
  }
}

export async function handleBulkStart(id) {
  try {
    const group = getGroups().find((g) => g.id === id);
    if (!group) return jsonResponse({ success: false, error: "Group not found" }, 404);

    const results = [];
    for (const vmId of group.vmIds) {
      const vm = registry.get(vmId);
      if (!vm) continue;
      if (
        vm.status === STATUS.CREATED ||
        vm.status === STATUS.STOPPED ||
        vm.status === STATUS.ERROR
      ) {
        try {
          const started = await startVm(vmId);
          results.push({ vmId, success: true, data: toPublic(started) });
        } catch (e) {
          results.push({ vmId, success: false, error: e.message });
        }
      }
    }
    return jsonResponse({ success: true, data: results });
  } catch (e) {
    return errorResponse(e, 400);
  }
}

export async function handleBulkStop(id) {
  try {
    const group = getGroups().find((g) => g.id === id);
    if (!group) return jsonResponse({ success: false, error: "Group not found" }, 404);

    const results = [];
    for (const vmId of group.vmIds) {
      const vm = registry.get(vmId);
      if (!vm) continue;
      if (vm.status === STATUS.RUNNING || vm.status === STATUS.STARTING) {
        try {
          const stopped = await stopVm(vmId);
          results.push({ vmId, success: true, data: toPublic(stopped) });
        } catch (e) {
          results.push({ vmId, success: false, error: e.message });
        }
      }
    }
    return jsonResponse({ success: true, data: results });
  } catch (e) {
    return errorResponse(e, 400);
  }
}

export async function handleBulkDestroy(id) {
  try {
    const group = getGroups().find((g) => g.id === id);
    if (!group) return jsonResponse({ success: false, error: "Group not found" }, 404);

    const results = [];
    const toDestroy = [...group.vmIds];
    for (const vmId of toDestroy) {
      const vm = registry.get(vmId);
      if (!vm) continue;
      try {
        await destroyVm(vmId);
        results.push({ vmId, success: true });
      } catch (e) {
        results.push({ vmId, success: false, error: e.message });
      }
    }
    return jsonResponse({ success: true, data: results });
  } catch (e) {
    return errorResponse(e, 400);
  }
}

export async function handleBulkCreate(id, req) {
  try {
    const group = getGroups().find((g) => g.id === id);
    if (!group) return jsonResponse({ success: false, error: "Group not found" }, 404);

    const { count, template } = await req.json();
    if (!count || count < 1) {
      return jsonResponse({ success: false, error: "count must be >= 1" }, 400);
    }
    if (!template || !template.name || !template.backend || !template.imagePath) {
      return jsonResponse({ success: false, error: "template must include name, backend, imagePath" }, 400);
    }

    const results = [];
    const newVmIds = [];
    for (let i = 1; i <= count; i++) {
      try {
        const vm = await createVm({
          ...template,
          name: `${template.name}-${i}`,
        });
        results.push({ vmId: vm.id, success: true, data: toPublic(vm) });
        newVmIds.push(vm.id);
      } catch (e) {
        results.push({ index: i, success: false, error: e.message });
      }
    }

    if (newVmIds.length > 0) {
      await addVmsToGroup(id, newVmIds);
    }

    return jsonResponse({ success: true, data: results }, 201);
  } catch (e) {
    return errorResponse(e, 400);
  }
}
