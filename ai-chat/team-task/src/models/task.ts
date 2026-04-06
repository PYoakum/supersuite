export type TaskStatus = "todo" | "in-progress" | "blocked" | "done" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface StatusHistoryEntry {
  status: TaskStatus;
  timestamp: string;
  changedBy?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
  dependencies: string[];
  assignee: string;
  group: string;
  createdAt: string;
  updatedAt: string;
  startDate: string;
  dueDate: string;
  completedAt: string;
  statusHistory: StatusHistoryEntry[];
  tokensUsed: number;
  tokenBudget: number;
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  tags?: string[];
  dependencies?: string[];
  assignee?: string;
  group?: string;
  startDate?: string;
  dueDate?: string;
}

export interface UpdateTaskPayload {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  tags?: string[];
  dependencies?: string[];
  assignee?: string;
  group?: string;
  startDate?: string;
  dueDate?: string;
  tokensUsed?: number;
  tokenBudget?: number;
}

export interface TaskQuery {
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: string;
  group?: string;
  tag?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export const VALID_STATUSES: TaskStatus[] = ["todo", "in-progress", "blocked", "done", "cancelled"];
export const VALID_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "critical"];
