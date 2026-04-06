import { config } from "../config";
import { VALID_STATUSES, VALID_PRIORITIES } from "../models/task";
import type { CreateTaskPayload, UpdateTaskPayload } from "../models/task";

export function validateCreate(body: unknown): { errors: string[]; payload: CreateTaskPayload | null } {
  const errors: string[] = [];
  if (!body || typeof body !== "object") return { errors: ["Body must be a JSON object"], payload: null };

  const b = body as Record<string, unknown>;

  if (!b.title || typeof b.title !== "string" || b.title.trim().length === 0) {
    errors.push("title is required and must be a non-empty string");
  } else if (b.title.length > config.maxTitleLength) {
    errors.push(`title must be under ${config.maxTitleLength} characters`);
  }

  if (b.description !== undefined && typeof b.description !== "string") {
    errors.push("description must be a string");
  } else if (typeof b.description === "string" && b.description.length > config.maxDescriptionLength) {
    errors.push(`description must be under ${config.maxDescriptionLength} characters`);
  }

  if (b.status !== undefined && !VALID_STATUSES.includes(b.status as any)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  if (b.priority !== undefined && !VALID_PRIORITIES.includes(b.priority as any)) {
    errors.push(`priority must be one of: ${VALID_PRIORITIES.join(", ")}`);
  }

  if (b.tags !== undefined && (!Array.isArray(b.tags) || !b.tags.every((t: unknown) => typeof t === "string"))) {
    errors.push("tags must be an array of strings");
  }

  if (b.dependencies !== undefined && (!Array.isArray(b.dependencies) || !b.dependencies.every((d: unknown) => typeof d === "string"))) {
    errors.push("dependencies must be an array of task ID strings");
  }

  if (b.assignee !== undefined && typeof b.assignee !== "string") {
    errors.push("assignee must be a string");
  }

  if (b.group !== undefined && typeof b.group !== "string") {
    errors.push("group must be a string");
  }

  if (b.startDate !== undefined && typeof b.startDate === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(b.startDate)) {
    errors.push("startDate must be YYYY-MM-DD format");
  }

  if (b.dueDate !== undefined && typeof b.dueDate === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)) {
    errors.push("dueDate must be YYYY-MM-DD format");
  }

  if (errors.length > 0) return { errors, payload: null };

  return {
    errors: [],
    payload: {
      title: (b.title as string).trim(),
      description: (b.description as string) || undefined,
      status: b.status as any,
      priority: b.priority as any,
      tags: b.tags as string[] | undefined,
      dependencies: b.dependencies as string[] | undefined,
      assignee: b.assignee as string | undefined,
      group: b.group as string | undefined,
      startDate: b.startDate as string | undefined,
      dueDate: b.dueDate as string | undefined,
    },
  };
}

export function validateUpdate(body: unknown): { errors: string[]; payload: UpdateTaskPayload | null } {
  const errors: string[] = [];
  if (!body || typeof body !== "object") return { errors: ["Body must be a JSON object"], payload: null };

  const b = body as Record<string, unknown>;

  if (b.title !== undefined) {
    if (typeof b.title !== "string" || b.title.trim().length === 0) {
      errors.push("title must be a non-empty string");
    } else if (b.title.length > config.maxTitleLength) {
      errors.push(`title must be under ${config.maxTitleLength} characters`);
    }
  }

  if (b.description !== undefined && typeof b.description !== "string") {
    errors.push("description must be a string");
  }

  if (b.status !== undefined && !VALID_STATUSES.includes(b.status as any)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  if (b.priority !== undefined && !VALID_PRIORITIES.includes(b.priority as any)) {
    errors.push(`priority must be one of: ${VALID_PRIORITIES.join(", ")}`);
  }

  if (b.tags !== undefined && (!Array.isArray(b.tags) || !b.tags.every((t: unknown) => typeof t === "string"))) {
    errors.push("tags must be an array of strings");
  }

  if (b.dependencies !== undefined && (!Array.isArray(b.dependencies) || !b.dependencies.every((d: unknown) => typeof d === "string"))) {
    errors.push("dependencies must be an array of task ID strings");
  }

  if (b.assignee !== undefined && typeof b.assignee !== "string") {
    errors.push("assignee must be a string");
  }

  if (b.group !== undefined && typeof b.group !== "string") {
    errors.push("group must be a string");
  }

  if (b.startDate !== undefined && typeof b.startDate === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(b.startDate)) {
    errors.push("startDate must be YYYY-MM-DD format");
  }

  if (b.dueDate !== undefined && typeof b.dueDate === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)) {
    errors.push("dueDate must be YYYY-MM-DD format");
  }

  if (b.tokensUsed !== undefined && (typeof b.tokensUsed !== "number" || b.tokensUsed < 0)) {
    errors.push("tokensUsed must be a non-negative number");
  }

  if (b.tokenBudget !== undefined && (typeof b.tokenBudget !== "number" || b.tokenBudget < 0)) {
    errors.push("tokenBudget must be a non-negative number");
  }

  if (errors.length > 0) return { errors, payload: null };

  const payload: UpdateTaskPayload = {};
  if (b.title !== undefined) payload.title = (b.title as string).trim();
  if (b.description !== undefined) payload.description = b.description as string;
  if (b.status !== undefined) payload.status = b.status as any;
  if (b.priority !== undefined) payload.priority = b.priority as any;
  if (b.tags !== undefined) payload.tags = b.tags as string[];
  if (b.dependencies !== undefined) payload.dependencies = b.dependencies as string[];
  if (b.assignee !== undefined) payload.assignee = b.assignee as string;
  if (b.group !== undefined) payload.group = b.group as string;
  if (b.startDate !== undefined) payload.startDate = b.startDate as string;
  if (b.dueDate !== undefined) payload.dueDate = b.dueDate as string;
  if (b.tokensUsed !== undefined) payload.tokensUsed = b.tokensUsed as number;
  if (b.tokenBudget !== undefined) payload.tokenBudget = b.tokenBudget as number;

  return { errors: [], payload };
}

export function validateImport(body: unknown): { errors: string[]; tasks: CreateTaskPayload[] } {
  if (!body || typeof body !== "object") return { errors: ["Body must be a JSON object"], tasks: [] };

  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.tasks)) return { errors: ["Body must contain a tasks array"], tasks: [] };

  const allErrors: string[] = [];
  const tasks: CreateTaskPayload[] = [];

  for (let i = 0; i < b.tasks.length; i++) {
    const { errors, payload } = validateCreate(b.tasks[i]);
    if (errors.length > 0) {
      allErrors.push(`tasks[${i}]: ${errors.join("; ")}`);
    } else if (payload) {
      tasks.push(payload);
    }
  }

  return { errors: allErrors, tasks };
}
