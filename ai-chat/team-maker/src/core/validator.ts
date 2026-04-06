import type { EvaluateResponse, EvaluateRequest } from "./schema";

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Validate that the evaluation response covers all tasks,
 * respects role counts, and has no structural issues.
 */
export function validateResponse(
  response: EvaluateResponse,
  request: EvaluateRequest
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check task coverage
  const allTaskIds = new Set(response.tasks.map(t => t.id));
  const assignedTaskIds = new Set(response.assignments.flatMap(a => a.taskIds));

  for (const id of allTaskIds) {
    if (!assignedTaskIds.has(id)) {
      warnings.push(`Task ${id} is not assigned to any role`);
    }
  }

  // Check for assigned tasks that don't exist
  for (const id of assignedTaskIds) {
    if (!allTaskIds.has(id)) {
      warnings.push(`Assignment references unknown task ${id}`);
    }
  }

  // Check role counts
  const aiRoles = response.assignments.filter(a => a.roleType === "ai");
  const humanRoles = response.assignments.filter(a => a.roleType === "human");

  if (aiRoles.length !== request.aiAgentCount) {
    warnings.push(`Requested ${request.aiAgentCount} AI agents but got ${aiRoles.length}`);
  }
  if (humanRoles.length !== request.humanCount) {
    warnings.push(`Requested ${request.humanCount} humans but got ${humanRoles.length}`);
  }

  // Check prompts exist for all roles
  const promptRoleIds = new Set(response.prompts.map(p => p.roleId));
  for (const assignment of response.assignments) {
    if (!promptRoleIds.has(assignment.roleId)) {
      warnings.push(`No prompt generated for role ${assignment.roleId}`);
    }
  }

  // Check for empty prompts
  for (const prompt of response.prompts) {
    if (!prompt.prompt || prompt.prompt.trim().length < 20) {
      warnings.push(`Prompt for ${prompt.roleId} is too short or empty`);
    }
  }

  // Check for idle roles (no tasks assigned)
  for (const assignment of response.assignments) {
    if (assignment.taskIds.length === 0) {
      warnings.push(`Role ${assignment.roleId} has no tasks assigned`);
    }
  }

  // Check for missing tasks
  if (response.tasks.length === 0) {
    errors.push("No tasks were generated");
  }

  // Update coverage report
  if (response.coverageReport.uncoveredTaskIds.length > 0) {
    warnings.push(
      `${response.coverageReport.uncoveredTaskIds.length} task(s) flagged as uncovered: ${response.coverageReport.uncoveredTaskIds.join(", ")}`
    );
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
