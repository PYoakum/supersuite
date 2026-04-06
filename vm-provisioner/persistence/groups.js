/**
 * Group persistence and CRUD operations
 * Groups stored in .vm-groups.json, independent of VM state
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { loadJson, saveJson } from "../lib/state.js";
import { DEFAULTS } from "../lib/constants.js";
import * as registry from "../vm/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GROUPS_PATH = join(__dirname, "..", DEFAULTS.GROUPS_FILE);

let groups = [];

function generateGroupId() {
  return "g" + randomBytes(4).toString("hex");
}

/**
 * Load groups from disk, pruning any VM IDs that no longer exist
 */
export async function loadGroups() {
  const data = await loadJson(GROUPS_PATH, { groups: [] });
  groups = data.groups || [];

  // Auto-prune deleted VM IDs
  const validIds = new Set(registry.list().map((vm) => vm.id));
  let pruned = false;
  for (const group of groups) {
    const before = group.vmIds.length;
    group.vmIds = group.vmIds.filter((id) => validIds.has(id));
    if (group.vmIds.length !== before) pruned = true;
  }
  if (pruned) await saveGroups();

  return groups;
}

/**
 * Save current groups to disk
 */
export async function saveGroups() {
  await saveJson(GROUPS_PATH, { groups });
}

/**
 * Get all groups
 */
export function getGroups() {
  return groups;
}

/**
 * Create a new group
 */
export async function addGroup(name, color) {
  const group = {
    id: generateGroupId(),
    name,
    vmIds: [],
    color: color || "#3b82f6",
  };
  groups.push(group);
  await saveGroups();
  return group;
}

/**
 * Remove a group by ID
 */
export async function removeGroup(id) {
  const idx = groups.findIndex((g) => g.id === id);
  if (idx === -1) throw new Error(`Group not found: ${id}`);
  groups.splice(idx, 1);
  await saveGroups();
}

/**
 * Update group name/color
 */
export async function updateGroup(id, updates) {
  const group = groups.find((g) => g.id === id);
  if (!group) throw new Error(`Group not found: ${id}`);
  if (updates.name !== undefined) group.name = updates.name;
  if (updates.color !== undefined) group.color = updates.color;
  await saveGroups();
  return group;
}

/**
 * Add VM IDs to a group
 */
export async function addVmsToGroup(groupId, vmIds) {
  const group = groups.find((g) => g.id === groupId);
  if (!group) throw new Error(`Group not found: ${groupId}`);
  const existing = new Set(group.vmIds);
  for (const id of vmIds) {
    if (!existing.has(id)) group.vmIds.push(id);
  }
  await saveGroups();
  return group;
}

/**
 * Remove VM IDs from a group
 */
export async function removeVmsFromGroup(groupId, vmIds) {
  const group = groups.find((g) => g.id === groupId);
  if (!group) throw new Error(`Group not found: ${groupId}`);
  const toRemove = new Set(vmIds);
  group.vmIds = group.vmIds.filter((id) => !toRemove.has(id));
  await saveGroups();
  return group;
}
