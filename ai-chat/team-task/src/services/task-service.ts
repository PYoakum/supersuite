import { storageService } from "./storage-service";
import { wsService } from "./websocket-service";
import { notifyService, type NotifyResult } from "./notify-service";
import { generateTaskId } from "../utils/ids";
import { config } from "../config";
import type { Task, CreateTaskPayload, UpdateTaskPayload, TaskQuery } from "../models/task";

class TaskService {
  create(payload: CreateTaskPayload): Task {
    const now = new Date().toISOString();
    const initialStatus = payload.status || "todo";
    const task: Task = {
      id: generateTaskId(),
      title: payload.title,
      description: payload.description || "",
      status: initialStatus,
      priority: payload.priority || "medium",
      tags: payload.tags || [],
      dependencies: payload.dependencies || [],
      assignee: payload.assignee || "",
      group: payload.group || "",
      createdAt: now,
      updatedAt: now,
      startDate: payload.startDate || "",
      dueDate: payload.dueDate || "",
      completedAt: "",
      statusHistory: [{ status: initialStatus, timestamp: now }],
      tokensUsed: 0,
      tokenBudget: 0,
    };

    storageService.append(task);
    wsService.broadcast("task:created", task);

    if (config.notifyOnChange) {
      notifyService.notifyTaskChange(task, "created");
    }

    return task;
  }

  update(id: string, payload: UpdateTaskPayload): Task | null {
    const existing = storageService.getById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    // Apply defaults for old records missing new fields
    const base: Task = {
      statusHistory: [], tokensUsed: 0, tokenBudget: 0,
      ...existing,
    };

    const updated: Task = { ...base, ...payload, updatedAt: now };

    if (payload.status === "done" && base.status !== "done") {
      updated.completedAt = now;
    } else if (payload.status && payload.status !== "done") {
      updated.completedAt = "";
    }

    // Track status changes
    if (payload.status && payload.status !== base.status) {
      updated.statusHistory = [
        ...(base.statusHistory || []),
        { status: payload.status, timestamp: now, changedBy: payload.assignee || base.assignee || "system" },
      ];
    }

    // Token fields are additive when provided
    if (payload.tokensUsed !== undefined) {
      updated.tokensUsed = (base.tokensUsed || 0) + payload.tokensUsed;
    }
    if (payload.tokenBudget !== undefined) {
      updated.tokenBudget = payload.tokenBudget;
    }

    storageService.append(updated);
    wsService.broadcast("task:updated", updated);

    if (config.notifyOnChange) {
      const changes: string[] = [];
      if (payload.status && payload.status !== existing.status) changes.push(`status → ${payload.status}`);
      if (payload.assignee && payload.assignee !== existing.assignee) changes.push(`assignee → ${payload.assignee}`);
      if (payload.priority && payload.priority !== existing.priority) changes.push(`priority → ${payload.priority}`);
      if (changes.length > 0) {
        notifyService.notifyTaskChange(updated, changes.join(", "));
      }
    }

    return updated;
  }

  delete(id: string): boolean {
    const task = storageService.getById(id);
    if (!task) return false;

    const removed = storageService.remove(id);
    if (removed) {
      wsService.broadcast("task:deleted", { id });
      if (config.notifyOnChange) {
        notifyService.notifyTaskChange(task, "deleted");
      }
    }
    return removed;
  }

  getById(id: string): Task | undefined {
    return storageService.getById(id);
  }

  list(query: TaskQuery): { tasks: Task[]; total: number } {
    let tasks = storageService.getAll();

    if (query.status) tasks = tasks.filter((t) => t.status === query.status);
    if (query.priority) tasks = tasks.filter((t) => t.priority === query.priority);
    if (query.assignee) tasks = tasks.filter((t) => t.assignee === query.assignee);
    if (query.group) tasks = tasks.filter((t) => t.group === query.group);
    if (query.tag) tasks = tasks.filter((t) => t.tags.includes(query.tag!));
    if (query.q) {
      const q = query.q.toLowerCase();
      tasks = tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }

    const total = tasks.length;
    const limit = Math.min(query.limit || config.defaultPageSize, config.maxPageSize);
    const offset = query.offset || 0;
    tasks = tasks.slice(offset, offset + limit);

    return { tasks, total };
  }

  import(payloads: CreateTaskPayload[]): Task[] {
    const created: Task[] = [];
    for (const p of payloads) {
      created.push(this.create(p));
    }

    if (config.notifyOnChange && created.length > 0) {
      notifyService.notifyImport(created.length);
    }

    wsService.broadcast("tasks:imported", { count: created.length });
    return created;
  }

  stats(): {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    groups: string[];
    assignees: string[];
    connectedClients: number;
  } {
    const all = storageService.getAll();
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const groups = new Set<string>();
    const assignees = new Set<string>();

    for (const t of all) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      if (t.group) groups.add(t.group);
      if (t.assignee) assignees.add(t.assignee);
    }

    return {
      total: all.length,
      byStatus,
      byPriority,
      groups: [...groups],
      assignees: [...assignees],
      connectedClients: wsService.connectedCount(),
    };
  }

  export(): Task[] {
    return storageService.getAll();
  }

  clear(): void {
    storageService.clear();
    wsService.broadcast("tasks:cleared", {});
  }

  notify(id: string): Promise<NotifyResult & { found: boolean }> {
    const task = storageService.getById(id);
    if (!task) return Promise.resolve({ sent: false, reason: "Task not found", found: false });
    return notifyService.notifyTaskChange(task, `status: ${task.status}`).then((r) => ({ ...r, found: true }));
  }
}

export const taskService = new TaskService();
