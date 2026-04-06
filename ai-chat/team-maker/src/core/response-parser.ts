import type { EvaluateResponse } from "./schema";

/**
 * Parse the LLM response into a structured EvaluateResponse.
 * Handles JSON extraction, repair, and validation.
 */
export function parseResponse(raw: string): EvaluateResponse {
  const json = extractJSON(raw);
  const parsed = JSON.parse(json);

  return {
    summary: parsed.summary || "",
    tasks: (parsed.tasks || []).map(normalizeTask),
    assignments: (parsed.assignments || []).map(normalizeAssignment),
    prompts: (parsed.prompts || []).map(normalizePrompt),
    coverageReport: {
      coveredTaskIds: parsed.coverageReport?.coveredTaskIds || [],
      uncoveredTaskIds: parsed.coverageReport?.uncoveredTaskIds || [],
      notes: parsed.coverageReport?.notes || [],
    },
    ambiguities: parsed.ambiguities || [],
  };
}

/**
 * Extract JSON from LLM output that may contain markdown fencing, prose,
 * trailing commas, or other non-strict-JSON artifacts.
 */
function extractJSON(raw: string): string {
  // Try direct parse
  try { JSON.parse(raw); return raw; } catch {}

  // Try extracting from markdown code fence (greedy — take the largest block)
  const fenceMatches = [...raw.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/g)];
  for (const m of fenceMatches) {
    const repaired = repairJSON(m[1]);
    try { JSON.parse(repaired); return repaired; } catch {}
  }

  // Try first { to last }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const repaired = repairJSON(raw.slice(start, end + 1));
    try { JSON.parse(repaired); return repaired; } catch {}
  }

  // Show a useful snippet of what came back
  const preview = raw.slice(0, 300).replace(/\n/g, "\\n");
  throw new Error(`Could not extract valid JSON from LLM response. Preview: ${preview}`);
}

/**
 * Attempt common repairs on almost-valid JSON:
 * - Strip trailing commas before } or ]
 * - Remove control characters
 * - Fix unescaped newlines inside strings
 */
function repairJSON(text: string): string {
  let s = text.trim();

  // Remove control characters (except \n \r \t which are handled by JSON)
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");

  // Fix trailing commas: ,] or ,}
  s = s.replace(/,\s*([\]}])/g, "$1");

  // Fix unescaped newlines inside JSON string values
  // Match content between quotes and escape bare newlines
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
    return match.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  });

  return s;
}

function normalizeTask(t: Record<string, unknown>) {
  return {
    id: String(t.id || ""),
    title: String(t.title || ""),
    description: t.description ? String(t.description) : undefined,
    workstream: t.workstream ? String(t.workstream) : undefined,
    dependencies: Array.isArray(t.dependencies) ? t.dependencies.map(String) : undefined,
    deliverables: Array.isArray(t.deliverables) ? t.deliverables.map(String) : undefined,
    suggestedOwnerType: normalizeOwnerType(t.suggestedOwnerType),
    priority: normalizePriority(t.priority),
  };
}

function normalizeAssignment(a: Record<string, unknown>) {
  return {
    roleId: String(a.roleId || ""),
    roleType: (a.roleType === "human" ? "human" : "ai") as "ai" | "human",
    focus: String(a.focus || ""),
    taskIds: Array.isArray(a.taskIds) ? a.taskIds.map(String) : [],
  };
}

function normalizePrompt(p: Record<string, unknown>) {
  return {
    roleId: String(p.roleId || ""),
    roleType: (p.roleType === "human" ? "human" : "ai") as "ai" | "human",
    prompt: String(p.prompt || ""),
  };
}

function normalizeOwnerType(v: unknown): "ai" | "human" | "either" {
  if (v === "ai" || v === "human") return v;
  return "either";
}

function normalizePriority(v: unknown): "low" | "medium" | "high" {
  if (v === "low" || v === "high") return v;
  return "medium";
}
