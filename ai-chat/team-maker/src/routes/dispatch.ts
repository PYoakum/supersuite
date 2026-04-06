import { config } from "../config";
import { getLastResult } from "./roles";

interface DispatchRequest {
  target: "chat" | "tasks";
  roleIds?: string[];  // specific roles, or omit for all
}

/**
 * Dispatch prompts to chat server, or tasks to team-task.
 */
export async function handleDispatch(req: Request): Promise<Response> {
  const lastResult = getLastResult();
  if (!lastResult) {
    return Response.json(
      { ok: false, errors: ["No evaluation result — run an evaluation or import first"] },
      { status: 400 },
    );
  }

  let body: DispatchRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, errors: ["Invalid JSON body"] }, { status: 400 });
  }

  if (!body.target || !["chat", "tasks"].includes(body.target)) {
    return Response.json(
      { ok: false, errors: ["target must be 'chat' or 'tasks'"] },
      { status: 400 },
    );
  }

  if (body.target === "chat") {
    return dispatchToChat(body.roleIds);
  }
  return dispatchToTasks(body.roleIds);
}

async function dispatchToChat(roleIds?: string[]): Promise<Response> {
  const lastResult = getLastResult()!;
  const prompts = roleIds
    ? lastResult.prompts.filter(p => roleIds.includes(p.roleId))
    : lastResult.prompts;

  if (prompts.length === 0) {
    return Response.json({ ok: false, errors: ["No matching prompts to dispatch"] }, { status: 400 });
  }

  const results: { roleId: string; ok: boolean; error?: string; messageId?: string }[] = [];

  for (const prompt of prompts) {
    try {
      const res = await fetch(`${config.chatServerUrl}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderType: "system",
          senderId: "team-maker",
          displayName: "Team Maker",
          role: "coordinator",
          content: `[Assignment: ${prompt.roleId}]\n\n${prompt.prompt}`,
          tags: ["team-maker", prompt.roleId, prompt.roleType],
          channel: "general",
        }),
      });

      const data = await res.json();
      if (data.ok) {
        results.push({ roleId: prompt.roleId, ok: true, messageId: data.message?.id });
      } else {
        results.push({ roleId: prompt.roleId, ok: false, error: data.errors?.join(", ") });
      }
    } catch (err) {
      results.push({
        roleId: prompt.roleId,
        ok: false,
        error: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  return Response.json({
    ok: results.every(r => r.ok),
    dispatched: results.filter(r => r.ok).length,
    total: results.length,
    results,
  });
}

async function dispatchToTasks(roleIds?: string[]): Promise<Response> {
  const lastResult = getLastResult()!;

  // Filter tasks by role if specified
  let taskIds: Set<string> | null = null;
  if (roleIds) {
    taskIds = new Set(
      lastResult.assignments
        .filter(a => roleIds.includes(a.roleId))
        .flatMap(a => a.taskIds)
    );
  }

  const tasks = taskIds
    ? lastResult.tasks.filter(t => taskIds!.has(t.id))
    : lastResult.tasks;

  if (tasks.length === 0) {
    return Response.json({ ok: false, errors: ["No matching tasks to dispatch"] }, { status: 400 });
  }

  // Build dependency map: plan task ID -> team-task ID (filled after import)
  // Compute start dates by staggering tasks based on dependency order
  const today = new Date().toISOString().slice(0, 10);

  function addDays(date: string, days: number): string {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // Simple topological ordering for date staggering
  const taskDepths = new Map<string, number>();
  function getDepth(id: string, visited = new Set<string>()): number {
    if (taskDepths.has(id)) return taskDepths.get(id)!;
    if (visited.has(id)) return 0;
    visited.add(id);
    const task = tasks.find(t => t.id === id);
    const deps = task?.dependencies || [];
    const depth = deps.length === 0 ? 0 : Math.max(...deps.map(d => getDepth(d, visited) + 1));
    taskDepths.set(id, depth);
    return depth;
  }
  for (const t of tasks) getDepth(t.id);

  // Map tasks to team-task format
  const payload = tasks.map(t => {
    const assignment = lastResult.assignments.find(a => a.taskIds.includes(t.id));
    const assigneeName = assignment?.displayName || assignment?.roleId || undefined;
    const depth = taskDepths.get(t.id) || 0;
    const startDate = addDays(today, depth * 2);
    const dueDate = addDays(startDate, 2);

    return {
      title: `[${t.id}] ${t.title}`,
      description: t.description || "",
      status: "todo" as const,
      priority: t.priority || "medium",
      tags: [
        "team-maker",
        t.id,
        ...(t.workstream ? [t.workstream] : []),
        ...(assignment ? [assignment.roleId] : []),
      ],
      assignee: assigneeName,
      group: t.workstream || undefined,
      dependencies: t.dependencies || [],
      startDate,
      dueDate,
    };
  });

  try {
    const res = await fetch(`${config.taskServerUrl}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: payload }),
    });

    const data = await res.json();
    if (data.ok) {
      return Response.json({
        ok: true,
        dispatched: payload.length,
        total: payload.length,
        imported: data.imported,
      });
    } else {
      return Response.json({
        ok: false,
        errors: data.errors || ["Task import failed"],
      }, { status: 500 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({
      ok: false,
      errors: [`Task server (${config.taskServerUrl}) unreachable: ${msg}. Is team-task running on port 3001?`],
    }, { status: 502 });
  }
}
