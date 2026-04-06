import type { EvaluateResponse } from "./schema";
import type { ValidationResult } from "./validator";

/**
 * Format an evaluation response as Markdown for export or display.
 */
export function toMarkdown(
  response: EvaluateResponse,
  validation?: ValidationResult
): string {
  const lines: string[] = [];

  lines.push("# Project Decomposition\n");
  lines.push(`## Summary\n\n${response.summary}\n`);

  // Tasks
  lines.push("## Tasks\n");
  for (const task of response.tasks) {
    const priority = task.priority ? ` [${task.priority}]` : "";
    const owner = task.suggestedOwnerType ? ` (${task.suggestedOwnerType})` : "";
    lines.push(`- **${task.id}**: ${task.title}${priority}${owner}`);
    if (task.description && task.description !== task.title) {
      lines.push(`  ${task.description}`);
    }
    if (task.deliverables?.length) {
      lines.push(`  Deliverables: ${task.deliverables.join(", ")}`);
    }
    if (task.dependencies?.length) {
      lines.push(`  Depends on: ${task.dependencies.join(", ")}`);
    }
  }
  lines.push("");

  // Assignments
  lines.push("## Assignments\n");
  const aiAssignments = response.assignments.filter(a => a.roleType === "ai");
  const humanAssignments = response.assignments.filter(a => a.roleType === "human");

  if (aiAssignments.length) {
    lines.push("### AI Agents\n");
    for (const a of aiAssignments) {
      lines.push(`**${a.roleId}** — ${a.focus}`);
      lines.push(`Tasks: ${a.taskIds.join(", ")}\n`);
    }
  }

  if (humanAssignments.length) {
    lines.push("### Human Team Members\n");
    for (const a of humanAssignments) {
      lines.push(`**${a.roleId}** — ${a.focus}`);
      lines.push(`Tasks: ${a.taskIds.join(", ")}\n`);
    }
  }

  // Prompts
  lines.push("## Generated Prompts\n");
  for (const p of response.prompts) {
    const label = p.roleType === "ai" ? "AI Agent" : "Human";
    lines.push(`### ${p.roleId} (${label})\n`);
    lines.push(p.prompt);
    lines.push("\n---\n");
  }

  // Coverage
  if (response.coverageReport.uncoveredTaskIds.length > 0) {
    lines.push("## Coverage Gaps\n");
    lines.push(`Uncovered tasks: ${response.coverageReport.uncoveredTaskIds.join(", ")}\n`);
  }
  if (response.coverageReport.notes.length > 0) {
    lines.push("### Notes\n");
    for (const note of response.coverageReport.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  // Ambiguities
  if (response.ambiguities.length > 0) {
    lines.push("## Ambiguities & Open Questions\n");
    for (const a of response.ambiguities) {
      lines.push(`- ${a}`);
    }
    lines.push("");
  }

  // Validation warnings
  if (validation && validation.warnings.length > 0) {
    lines.push("## Validation Warnings\n");
    for (const w of validation.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
