import { config } from "./config";
import { getLastResult } from "./routes/roles";
import type { RoleAssignment } from "./core/schema";

const TASK_PATTERN = /\[TASK:(\w+):(todo|in-progress|blocked|done|cancelled)\]/gi;

interface TaskUpdate {
  taskId: string;
  status: string;
  agentId: string;
}

/** Match a WebSocket senderId to a role assignment. senderId is the kebab-cased displayName. */
function findAssignmentBySenderId(senderId: string): RoleAssignment | undefined {
  const lastResult = getLastResult();
  if (!lastResult) return undefined;

  return lastResult.assignments.find((a) => {
    if (a.roleId === senderId) return true;
    const kebab = (a.displayName || a.roleId).toLowerCase().replace(/[^a-z0-9-]/g, "-");
    return kebab === senderId;
  });
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Connect to the chat server WebSocket and watch for task status
 * commands from agents. When detected, relay to team-task API.
 */
export function startTaskBridge() {
  const wsUrl = config.chatServerUrl.replace(/^http/, "ws") + "/ws";
  console.log(`[task-bridge] Connecting to ${wsUrl}`);

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[task-bridge] Connected — watching for task updates");
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (!pollTimer) startTaskPoller();
  };

  ws.onmessage = (event) => {
    try {
      const envelope = JSON.parse(String(event.data));
      if (envelope.type !== "message:created") return;

      const msg = envelope.payload;
      if (!msg?.content || msg.senderType === "system") return;

      const updates = parseTaskUpdates(msg.content, msg.senderId);
      for (const update of updates) {
        relayUpdate(update);
      }
    } catch {}
  };

  ws.onclose = () => {
    console.log("[task-bridge] Disconnected — reconnecting in 5s");
    reconnectTimer = setTimeout(startTaskBridge, 5000);
  };

  ws.onerror = () => {};
}

function parseTaskUpdates(content: string, agentId: string): TaskUpdate[] {
  const updates: TaskUpdate[] = [];
  let match: RegExpExecArray | null;

  TASK_PATTERN.lastIndex = 0;
  while ((match = TASK_PATTERN.exec(content)) !== null) {
    updates.push({
      taskId: match[1],
      status: match[2].toLowerCase(),
      agentId,
    });
  }

  return updates;
}

// Status progression: transitions are only allowed forward, never backward
const STATUS_ORDER: Record<string, number> = {
  "todo": 0,
  "in-progress": 1,
  "blocked": 1,     // same level as in-progress (lateral move allowed)
  "done": 2,
  "cancelled": 2,
};

function isValidTransition(from: string, to: string): boolean {
  const fromRank = STATUS_ORDER[from] ?? 0;
  const toRank = STATUS_ORDER[to] ?? 0;
  // Never go backward (done -> in-progress, done -> todo, etc.)
  return toRank >= fromRank;
}

async function findTask(taskId: string): Promise<any | null> {
  // Direct ID lookup (handles full task IDs like task_1775409628349_0_j6kz)
  try {
    const res = await fetch(`${config.taskServerUrl}/api/tasks/${encodeURIComponent(taskId)}`);
    const data = await res.json();
    if (data.ok && data.task) return data.task;
  } catch {}

  // Search by tag
  try {
    const res = await fetch(`${config.taskServerUrl}/api/tasks?tag=${encodeURIComponent(taskId)}&limit=10`);
    const data = await res.json();
    if (data.ok && data.tasks?.length) return data.tasks[0];
  } catch {}

  // Fallback: search by title
  try {
    const res = await fetch(`${config.taskServerUrl}/api/tasks?q=${encodeURIComponent("[" + taskId + "]")}&limit=10`);
    const data = await res.json();
    if (data.ok && data.tasks?.length) return data.tasks[0];
  } catch {}

  return null;
}

async function checkDependenciesMet(task: any): Promise<{ met: boolean; blocking: string[] }> {
  const deps = task.dependencies || [];
  if (deps.length === 0) return { met: true, blocking: [] };

  const blocking: string[] = [];

  for (const depId of deps) {
    const dep = await findTask(depId);
    if (!dep) continue; // can't verify, allow it
    if (dep.status !== "done" && dep.status !== "cancelled") {
      blocking.push(`${depId} (${dep.status})`);
    }
  }

  return { met: blocking.length === 0, blocking };
}

async function relayUpdate(update: TaskUpdate) {
  console.log(`[task-bridge] ${update.agentId}: ${update.taskId} -> ${update.status}`);

  // Permission check: only PMs (and humans/unknown senders) can update task status
  const senderAssignment = findAssignmentBySenderId(update.agentId);
  if (senderAssignment?.roleKind === "worker") {
    const pmId = senderAssignment.managedBy;
    const lastResult = getLastResult();
    const pm = lastResult?.assignments.find((a) => a.roleId === pmId);
    const pmName = pm?.displayName || pmId || "your PM";
    console.log(`[task-bridge] Rejected: ${update.agentId} is a worker, only PMs can update tasks`);
    await postRejection(
      update,
      `${senderAssignment.displayName || update.agentId}: only your PM can update task status. Report your progress to ${pmName} in plain language and they will update the board.`,
    );
    return;
  }

  try {
    const task = await findTask(update.taskId);

    if (!task) {
      console.log(`[task-bridge] Task ${update.taskId} not found in team-task`);
      return;
    }

    // Guard: no status regression
    if (!isValidTransition(task.status, update.status)) {
      console.log(`[task-bridge] Rejected: ${update.taskId} ${task.status} -> ${update.status} (regression)`);
      await postRejection(update, `Cannot move ${update.taskId} from "${task.status}" back to "${update.status}".`);
      return;
    }

    // Guard: dependencies must be met before marking done
    if (update.status === "done") {
      const { met, blocking } = await checkDependenciesMet(task);
      if (!met) {
        console.log(`[task-bridge] Rejected: ${update.taskId} -> done (blocked by ${blocking.join(", ")})`);
        await postRejection(update, `Cannot complete ${update.taskId} — dependencies not met: ${blocking.join(", ")}. Complete those first.`);
        return;
      }
    }

    // Guard: dependencies must be met before starting work
    if (update.status === "in-progress" && task.status === "todo") {
      const { met, blocking } = await checkDependenciesMet(task);
      if (!met) {
        console.log(`[task-bridge] Rejected: ${update.taskId} -> in-progress (blocked by ${blocking.join(", ")})`);
        await postRejection(update, `Cannot start ${update.taskId} — dependencies not met: ${blocking.join(", ")}. Those tasks must be completed first.`);
        // Set to blocked instead
        await updateTaskStatus(task.id, update.taskId, "blocked");
        return;
      }
    }

    await updateTaskStatus(task.id, update.taskId, update.status);
  } catch (err) {
    console.log(`[task-bridge] Error: ${err instanceof Error ? err.message : err}`);
  }
}

async function updateTaskStatus(taskDbId: string, planId: string, status: string) {
  const res = await fetch(`${config.taskServerUrl}/api/tasks/${taskDbId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const data = await res.json();
  if (data.ok) {
    console.log(`[task-bridge] Updated ${planId} -> ${status}`);
  } else {
    console.log(`[task-bridge] Failed: ${data.errors?.join(", ")}`);
  }
}

async function postRejection(update: TaskUpdate, reason: string) {
  try {
    await fetch(`${config.chatServerUrl}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderType: "system",
        senderId: "team-maker",
        displayName: "Task Board",
        role: "coordinator",
        content: `[Rejected] ${reason}`,
        tags: ["team-maker", "rejection", update.taskId],
        channel: "general",
      }),
    });
  } catch {}
}

// ── Task queue poller with stale detection ──
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastSnapshot: Record<string, string> = {};  // taskId -> status
let staleCount = 0;

function startTaskPoller() {
  pollTimer = setInterval(pollTaskQueue, 3 * 60_000); // every 3 minutes
  setTimeout(pollTaskQueue, 60_000);
}

async function pollTaskQueue() {
  try {
    const res = await fetch(`${config.taskServerUrl}/api/tasks?limit=500`);
    const data = await res.json();
    if (!data.ok || !data.tasks?.length) return;

    const incomplete = data.tasks.filter(
      (t: any) => t.status !== "done" && t.status !== "cancelled"
    );

    if (incomplete.length === 0) {
      staleCount = 0;
      lastSnapshot = {};
      return;
    }

    // Check if any progress was made since last poll
    const currentSnapshot: Record<string, string> = {};
    for (const t of data.tasks) {
      // Extract plan task ID from tags
      const planId = t.tags?.find((tag: string) => /^T\d+$/i.test(tag));
      if (planId) currentSnapshot[planId] = t.status;
    }

    let changed = false;
    for (const [id, status] of Object.entries(currentSnapshot)) {
      if (lastSnapshot[id] !== status) { changed = true; break; }
    }
    // First poll is never stale
    if (Object.keys(lastSnapshot).length === 0) changed = true;

    lastSnapshot = currentSnapshot;

    if (!changed) {
      staleCount++;
    } else {
      staleCount = 0;
    }

    // Build status summary
    const byStatus: Record<string, string[]> = {};
    for (const t of incomplete) {
      const planId = t.tags?.find((tag: string) => /^T\d+$/i.test(tag)) || t.title.slice(0, 30);
      (byStatus[t.status] ??= []).push(planId);
    }

    const lines = Object.entries(byStatus)
      .map(([status, ids]) => `${status}: ${ids.join(", ")}`)
      .join("\n");

    // Find tasks whose dependencies are all met (ready to work on)
    const readyTasks: string[] = [];
    for (const t of incomplete) {
      if (t.status !== "todo") continue;
      const deps = t.dependencies || [];
      const allMet = deps.every((d: string) => {
        const depStatus = currentSnapshot[d];
        return depStatus === "done" || depStatus === "cancelled";
      });
      if (allMet) {
        const planId = t.tags?.find((tag: string) => /^T\d+$/i.test(tag)) || t.title.slice(0, 30);
        readyTasks.push(planId);
      }
    }

    let message = `[Queue Status] ${incomplete.length} task(s) remaining:\n${lines}`;

    if (readyTasks.length > 0) {
      message += `\n\nReady to start (dependencies met): ${readyTasks.join(", ")}`;
    }

    // Stale nudge: if no progress for 2+ polls, escalate
    if (staleCount >= 2) {
      message += `\n\n[STALE] No progress detected in ${staleCount * 3} minutes. Agents: please report status or begin work on an available task.`;
      console.log(`[task-bridge] Stale detected (${staleCount} polls, no change)`);
    }

    await fetch(`${config.chatServerUrl}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderType: "system",
        senderId: "team-maker",
        displayName: "Task Board",
        role: "coordinator",
        content: message,
        tags: ["team-maker", "queue-status"],
        channel: "general",
      }),
    });

    console.log(`[task-bridge] Queue poll: ${incomplete.length} incomplete, stale=${staleCount}`);
  } catch {}
}

export function stopTaskBridge() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (ws) ws.close();
  ws = null;
  pollTimer = null;
}
