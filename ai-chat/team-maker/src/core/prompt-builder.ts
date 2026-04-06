import type { EvaluateRequest } from "./schema";

const SYSTEM_PROMPT = `You decompose project plans into task assignments for AI agents and human team members. Return ONLY valid JSON, no markdown fencing or commentary.

Rules:
- Every task assigned to at least one role
- Humans: judgment, approvals, communication, accountability
- AI: coding, analysis, drafting, data processing, repetitive work
- No redundant assignments unless collaboration required
- Group related subtasks into single tasks — aim for 5-15 tasks total
- Omit optional fields if empty (no empty arrays, no null values)
- Task descriptions: 1-2 sentences
- Task deliverables: 1-3 words each
- Each role MUST have a prompt — do not skip any role
- Prompts should be actionable: include mission, owned task IDs, dependencies on other roles, and expected outputs

JSON schema:
{"summary":"1-3 sentences","tasks":[{"id":"T1","title":"short title","description":"1-2 sentences","workstream":"name","dependencies":["T2"],"deliverables":["output"],"suggestedOwnerType":"ai|human|either","priority":"low|medium|high"}],"assignments":[{"roleId":"AI-1","roleType":"ai","focus":"focus area","taskIds":["T1"]}],"prompts":[{"roleId":"AI-1","roleType":"ai","prompt":"role prompt here"}],"coverageReport":{"coveredTaskIds":["T1"],"uncoveredTaskIds":[],"notes":[]},"ambiguities":["unclear items"]}`;

export function buildMessages(request: EvaluateRequest): Array<{ role: "system" | "user"; content: string }> {
  const style = request.promptStyle || "concise";
  const strategy = request.allocationStrategy || "balanced";
  const totalRoles = request.aiAgentCount + request.humanCount;

  let userContent = `## Plan\n\n${request.plan}\n\n## Config\n`;
  userContent += `AI agents: ${request.aiAgentCount}, Humans: ${request.humanCount}\n`;
  userContent += `Style: ${style}, Strategy: ${strategy}\n`;

  if (request.includeRisks !== false) userContent += `Include risks: yes\n`;
  if (request.includeDependencies !== false) userContent += `Include dependencies: yes\n`;

  userContent += `\nDecompose into ${request.aiAgentCount} AI + ${request.humanCount} human roles.`;
  userContent += ` You MUST generate a prompt for each of the ${totalRoles} roles — do not omit any.`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}
