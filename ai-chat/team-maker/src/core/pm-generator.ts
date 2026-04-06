import type { EvaluateResponse, RoleAssignment, GeneratedPrompt } from "./schema";

const MAX_WORKERS_PER_PM = 4;

/**
 * Post-process an evaluation response to inject PM roles.
 * Groups AI workers by workstream, creates one PM per group,
 * strips task-status permissions from workers.
 */
export function generatePMRoles(response: EvaluateResponse): EvaluateResponse {
  const assignments = [...response.assignments];
  const prompts = [...response.prompts];

  // Collect AI worker assignments (skip any existing PMs)
  const aiWorkers = assignments.filter(
    (a) => a.roleType === "ai" && a.roleKind !== "pm",
  );

  if (aiWorkers.length === 0) return response;

  // Mark human roles
  for (const a of assignments) {
    if (a.roleType === "human") a.roleKind = "human";
  }

  // Group workers by workstream (derived from their tasks)
  const workstreamMap = new Map<string, string[]>(); // workstream -> roleIds
  for (const worker of aiWorkers) {
    const workstreams = new Set<string>();
    for (const taskId of worker.taskIds) {
      const task = response.tasks.find((t) => t.id === taskId);
      if (task?.workstream) workstreams.add(task.workstream);
    }
    const ws = workstreams.size === 1 ? [...workstreams][0] : "general";
    const group = workstreamMap.get(ws) || [];
    group.push(worker.roleId);
    workstreamMap.set(ws, group);
  }

  // Create PMs — one per workstream group, splitting large groups
  let pmIndex = 1;
  for (const [workstream, workerIds] of workstreamMap) {
    const chunks = chunkArray(workerIds, MAX_WORKERS_PER_PM);
    for (const chunk of chunks) {
      const pmRoleId = `PM-${pmIndex}`;
      const pmName = chunks.length > 1 || workstreamMap.size > 1
        ? `PM ${pmIndex} (${workstream})`
        : `PM ${pmIndex}`;

      // Collect task IDs from managed workers
      const pmTaskIds = new Set<string>();
      for (const wId of chunk) {
        const worker = assignments.find((a) => a.roleId === wId)!;
        worker.roleKind = "worker";
        worker.managedBy = pmRoleId;
        for (const tid of worker.taskIds) pmTaskIds.add(tid);
      }

      // Build the PM's team summary for its prompt
      const teamLines = chunk.map((wId) => {
        const worker = assignments.find((a) => a.roleId === wId)!;
        const name = worker.displayName || worker.roleId;
        return `- ${name}: ${worker.focus} (tasks: ${worker.taskIds.join(", ")})`;
      });

      const pmAssignment: RoleAssignment = {
        roleId: pmRoleId,
        displayName: pmName,
        roleType: "ai",
        roleKind: "pm",
        focus: `Project management for ${workstream}: coordinate ${chunk.join(", ")}`,
        taskIds: [...pmTaskIds],
        manages: [...chunk],
      };

      const pmPrompt: GeneratedPrompt = {
        roleId: pmRoleId,
        displayName: pmName,
        roleType: "ai",
        roleKind: "pm",
        prompt: buildPMPrompt(pmName, teamLines, [...pmTaskIds]),
      };

      assignments.push(pmAssignment);
      prompts.push(pmPrompt);
      pmIndex++;
    }
  }

  // Rewrite worker prompts to remove task-status tags and point to their PM
  for (const worker of aiWorkers) {
    const pm = assignments.find((a) => a.roleId === worker.managedBy);
    if (!pm) continue;

    const promptEntry = prompts.find((p) => p.roleId === worker.roleId);
    if (promptEntry) {
      promptEntry.roleKind = "worker";
      promptEntry.prompt = stripTaskStatusFromPrompt(
        promptEntry.prompt,
        pm.displayName || pm.roleId,
      );
    }
  }

  return {
    ...response,
    assignments,
    prompts,
  };
}

function buildPMPrompt(name: string, teamLines: string[], taskIds: string[]): string {
  return `You are ${name}, a Project Manager overseeing a team of AI workers.

YOUR TEAM:
${teamLines.join("\n")}

PM DUTIES:
- Keep your workers focused on their assigned tasks
- Unblock workers when they report issues — suggest solutions or reassign work
- Track progress and update the task board on behalf of your team
- Ensure deliverables meet quality standards before marking tasks done
- Coordinate handoffs between workers when tasks have dependencies
- Proactively check in with workers who haven't reported progress

TASK STATUS UPDATES (PM ONLY):
You are the ONLY one who can update task status on the board. Your workers will report progress to you in natural language. When appropriate, include these tags in your messages:
- [TASK:${taskIds[0] || "Tx"}:in-progress] — a worker has started a task
- [TASK:${taskIds[0] || "Tx"}:done] — a worker has completed a task
- [TASK:${taskIds[0] || "Tx"}:blocked] — a worker is blocked

Only mark a task done when the worker has confirmed completion and you are satisfied with the output.

TASK IDS YOU MANAGE: ${taskIds.join(", ")}`;
}

/**
 * Remove any TASK STATUS UPDATES section from a worker prompt
 * and replace with instructions to report to their PM.
 */
function stripTaskStatusFromPrompt(prompt: string, pmName: string): string {
  // Remove existing task status instructions if present
  const stripped = prompt.replace(
    /TASK STATUS UPDATES:[\s\S]*?(?=\n[A-Z]|\n\nYour |\Z)/,
    "",
  );

  return `${stripped.trim()}

TASK STATUS:
You do NOT update the task board directly. Your PM (${pmName}) manages all task status updates.
When you start, finish, or get blocked on work, report it to ${pmName} in plain language.
Do NOT use [TASK:...] tags — they will be ignored from you.`;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
