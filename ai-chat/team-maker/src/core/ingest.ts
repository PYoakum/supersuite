import type { ProjectPlan, Milestone, Workstream, Task, Dependency } from "./schema";

/**
 * Parse raw plan text (markdown or plain text) into a normalized ProjectPlan.
 * Extracts structure from headings, bullets, and common patterns.
 */
export function ingestPlan(raw: string, format?: string): ProjectPlan {
  if (format === "json") {
    return ingestJSON(raw);
  }
  return ingestMarkdown(raw);
}

function ingestJSON(raw: string): ProjectPlan {
  const parsed = JSON.parse(raw);
  return {
    title: parsed.title || "",
    summary: parsed.summary || "",
    goals: parsed.goals || [],
    constraints: parsed.constraints || [],
    milestones: parsed.milestones || [],
    workstreams: parsed.workstreams || [],
    tasks: parsed.tasks || [],
    assumptions: parsed.assumptions || [],
    risks: parsed.risks || [],
    dependencies: parsed.dependencies || [],
  };
}

interface Section {
  heading: string;
  level: number;
  lines: string[];
}

function ingestMarkdown(raw: string): ProjectPlan {
  const sections = splitSections(raw);
  const plan: ProjectPlan = {
    goals: [],
    constraints: [],
    milestones: [],
    workstreams: [],
    tasks: [],
    assumptions: [],
    risks: [],
    dependencies: [],
  };

  // Extract title from first H1
  const h1 = sections.find(s => s.level === 1);
  if (h1) plan.title = h1.heading;

  for (const section of sections) {
    const key = section.heading.toLowerCase();
    const bullets = extractBullets(section.lines);

    if (matches(key, ["overview", "summary", "description", "about"])) {
      plan.summary = section.lines.join("\n").trim();
    } else if (matches(key, ["goal", "objective"])) {
      plan.goals.push(...bullets);
    } else if (matches(key, ["constraint", "limitation", "boundary"])) {
      plan.constraints.push(...bullets);
    } else if (matches(key, ["milestone", "phase", "timeline"])) {
      plan.milestones.push(...parseMilestones(bullets, section));
    } else if (matches(key, ["workstream", "track", "stream"])) {
      plan.workstreams.push(...parseWorkstreams(bullets, section));
    } else if (matches(key, ["task", "action", "todo", "deliverable", "requirement", "feature"])) {
      plan.tasks.push(...parseTasks(bullets));
    } else if (matches(key, ["assumption"])) {
      plan.assumptions.push(...bullets);
    } else if (matches(key, ["risk", "concern", "issue"])) {
      plan.risks.push(...bullets);
    } else if (matches(key, ["dependenc"])) {
      plan.dependencies.push(...parseDependencies(bullets));
    }
  }

  // If no structured tasks found, treat all bullets as potential tasks
  if (plan.tasks.length === 0) {
    const allBullets = sections.flatMap(s => extractBullets(s.lines));
    plan.tasks = parseTasks(allBullets);
  }

  return plan;
}

function splitSections(raw: string): Section[] {
  const lines = raw.split("\n");
  const sections: Section[] = [];
  let current: Section = { heading: "(preamble)", level: 0, lines: [] };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (current.heading || current.lines.length) {
        sections.push(current);
      }
      current = {
        heading: headingMatch[2].trim(),
        level: headingMatch[1].length,
        lines: [],
      };
    } else {
      current.lines.push(line);
    }
  }
  if (current.heading || current.lines.length) {
    sections.push(current);
  }

  return sections;
}

function extractBullets(lines: string[]): string[] {
  return lines
    .map(l => l.replace(/^\s*[-*+]\s+/, "").replace(/^\s*\d+\.\s+/, "").trim())
    .filter(l => l.length > 0);
}

function matches(text: string, keywords: string[]): boolean {
  return keywords.some(k => text.includes(k));
}

let taskCounter = 0;

function parseTasks(bullets: string[]): Task[] {
  return bullets.map(b => ({
    id: `T${++taskCounter}`,
    title: b.length > 120 ? b.slice(0, 120) + "..." : b,
    description: b.length > 120 ? b : undefined,
    suggestedOwnerType: "either" as const,
    priority: "medium" as const,
  }));
}

function parseMilestones(bullets: string[], section: Section): Milestone[] {
  return bullets.map((b, i) => {
    const dateMatch = b.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    return {
      id: `M${i + 1}`,
      title: b,
      date: dateMatch?.[1],
    };
  });
}

function parseWorkstreams(bullets: string[], section: Section): Workstream[] {
  return bullets.map((b, i) => ({
    id: `W${i + 1}`,
    title: b,
    taskIds: [],
  }));
}

function parseDependencies(bullets: string[]): Dependency[] {
  return bullets.map(b => {
    const parts = b.split(/\s*(?:->|→|depends on|blocks|requires)\s*/i);
    return {
      from: parts[0]?.trim() || b,
      to: parts[1]?.trim() || "",
      type: "blocks" as const,
    };
  }).filter(d => d.to);
}

/** Reset the task counter (useful for testing) */
export function resetCounter() {
  taskCounter = 0;
}
