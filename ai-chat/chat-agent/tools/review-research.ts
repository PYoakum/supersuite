import { writeFile, mkdir, readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, basename } from "path";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  minRelevancyScore: 0.6,
  includeRecommendations: true,
};

const CRITERIA_WEIGHTS = {
  topicRelevance: 0.30,
  informationQuality: 0.25,
  sourceCredibility: 0.15,
  contentClarity: 0.15,
  contextFit: 0.15,
};

// ── Types ────────────────────────────────────────────────────

interface ResearchItem {
  path: string;
  content: string;
  metadata: Record<string, unknown>;
}

interface AnalysisItem {
  path: string;
  content: string;
  parsed: Record<string, unknown>;
}

interface ItemReview {
  source: string;
  score: number;
  strengths: string[];
  weaknesses: string[];
  keep: boolean;
}

interface ReviewResult {
  overall_score: number;
  verdict: string;
  criteria_scores: {
    topic_relevance: number;
    information_quality: number;
    source_credibility: number;
    content_clarity: number;
    context_fit: number;
  };
  item_reviews: ItemReview[];
  recommendations: {
    keep: string[];
    remove: string[];
    refine: string[];
  };
  summary: string;
  context_efficiency: {
    total_tokens_estimate: number;
    recommended_tokens: number;
    reduction_possible: number;
  };
}

interface LLMClient {
  send(args: {
    systemPrompt: string;
    userPrompt: string;
    parameters: { temperature: number; maxTokens: number };
  }): Promise<{ content: string }>;
}

interface SessionData {
  context?: {
    files: Array<{
      path: string;
      content: string;
      metadata?: Record<string, unknown>;
    }>;
  };
  sandboxPath?: string;
  [key: string]: unknown;
}

// ── Helpers ──────────────────────────────────────────────────

function parseYaml(yamlStr: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yamlStr.split("\n");
  let currentList: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("- ")) {
      const value = trimmed.slice(2).trim().replace(/^["']|["']$/g, "");
      if (currentList && Array.isArray(result[currentList])) {
        (result[currentList] as string[]).push(value);
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      let value = trimmed.slice(colonIdx + 1).trim();

      if (value === "" || value === "[]") {
        result[key] = [];
        currentList = key;
      } else {
        value = value.replace(/^["']|["']$/g, "");
        if (!isNaN(parseFloat(value)) && /^-?\d*\.?\d+$/.test(value)) {
          result[key] = parseFloat(value);
        } else if (value === "true") {
          result[key] = true;
        } else if (value === "false") {
          result[key] = false;
        } else {
          result[key] = value;
        }
        currentList = null;
      }
    }
  }

  return result;
}

function parseTomlValue(value: string): unknown {
  // String (double or single quoted)
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  if (value === "true") return true;
  if (value === "false") return false;

  // Array
  if (value.startsWith("[")) {
    try {
      const inner = value.slice(1, -1).trim();
      if (!inner) return [];

      const items: unknown[] = [];
      let current = "";
      let inQuote = false;
      let quoteChar = "";

      for (const char of inner) {
        if ((char === '"' || char === "'") && !inQuote) {
          inQuote = true;
          quoteChar = char;
          current += char;
        } else if (char === quoteChar && inQuote) {
          inQuote = false;
          current += char;
        } else if (char === "," && !inQuote) {
          items.push(parseTomlValue(current.trim()));
          current = "";
        } else {
          current += char;
        }
      }
      if (current.trim()) {
        items.push(parseTomlValue(current.trim()));
      }
      return items;
    } catch {
      return [];
    }
  }

  // Number
  if (/^-?\d*\.?\d+$/.test(value)) {
    return parseFloat(value);
  }

  return value;
}

function parseToml(tomlStr: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection: string | null = null;
  let currentArraySection: string | null = null;
  let currentArrayItem: Record<string, unknown> | null = null;

  const lines = tomlStr.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    // Array of tables: [[section]]
    const arrayMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayMatch) {
      if (currentArrayItem && currentArraySection) {
        if (!result[currentArraySection]) result[currentArraySection] = [];
        (result[currentArraySection] as Record<string, unknown>[]).push(currentArrayItem);
      }
      currentArraySection = arrayMatch[1].trim();
      currentArrayItem = {};
      currentSection = null;
      continue;
    }

    // Regular section: [section]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      if (currentArrayItem && currentArraySection) {
        if (!result[currentArraySection]) result[currentArraySection] = [];
        (result[currentArraySection] as Record<string, unknown>[]).push(currentArrayItem);
        currentArrayItem = null;
        currentArraySection = null;
      }
      currentSection = sectionMatch[1].trim();
      if (!result[currentSection]) result[currentSection] = {};
      continue;
    }

    // Key-value pair
    const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const value = kvMatch[2].trim();
      const parsedValue = parseTomlValue(value);

      if (currentArrayItem) {
        currentArrayItem[key] = parsedValue;
      } else if (currentSection) {
        (result[currentSection] as Record<string, unknown>)[key] = parsedValue;
      } else {
        result[key] = parsedValue;
      }
    }
  }

  // Save final array item
  if (currentArrayItem && currentArraySection) {
    if (!result[currentArraySection]) result[currentArraySection] = [];
    (result[currentArraySection] as Record<string, unknown>[]).push(currentArrayItem);
  }

  return result;
}

function escapeTomlString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function objectToToml(obj: Record<string, unknown>): string {
  const lines: string[] = ["# Research Review Output"];
  const sections: { key: string; obj: Record<string, unknown> }[] = [];
  const arrayTables: { key: string; items: Record<string, unknown>[] }[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      continue;
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key} = []`);
      } else if (typeof value[0] === "object") {
        arrayTables.push({ key, items: value as Record<string, unknown>[] });
      } else {
        const items = value.map((v) => `"${escapeTomlString(String(v))}"`);
        lines.push(`${key} = [${items.join(", ")}]`);
      }
    } else if (typeof value === "object") {
      sections.push({ key, obj: value as Record<string, unknown> });
    } else if (typeof value === "string") {
      lines.push(`${key} = "${escapeTomlString(value)}"`);
    } else if (typeof value === "boolean") {
      lines.push(`${key} = ${value}`);
    } else {
      lines.push(`${key} = ${value}`);
    }
  }

  for (const { key, obj: sectionObj } of sections) {
    lines.push("");
    lines.push(`[${key}]`);
    for (const [k, v] of Object.entries(sectionObj)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "string") {
        lines.push(`${k} = "${escapeTomlString(v)}"`);
      } else if (typeof v === "boolean") {
        lines.push(`${k} = ${v}`);
      } else if (Array.isArray(v)) {
        const items = v.map((item) => `"${escapeTomlString(String(item))}"`);
        lines.push(`${k} = [${items.join(", ")}]`);
      } else {
        lines.push(`${k} = ${v}`);
      }
    }
  }

  for (const { key, items } of arrayTables) {
    for (const item of items) {
      lines.push("");
      lines.push(`[[${key}]]`);
      for (const [k, v] of Object.entries(item)) {
        if (v === null || v === undefined) continue;
        if (typeof v === "string") {
          lines.push(`${k} = "${escapeTomlString(v)}"`);
        } else if (typeof v === "boolean") {
          lines.push(`${k} = ${v}`);
        } else if (Array.isArray(v)) {
          const arrItems = v.map((i) => `"${escapeTomlString(String(i))}"`);
          lines.push(`${k} = [${arrItems.join(", ")}]`);
        } else {
          lines.push(`${k} = ${v}`);
        }
      }
    }
  }

  return lines.join("\n");
}

// ── Research data retrieval ──────────────────────────────────

async function getResearchData(
  session: SessionData
): Promise<{ research: ResearchItem[]; analyses: AnalysisItem[] }> {
  if (!session.context?.files) {
    return { research: [], analyses: [] };
  }

  const research: ResearchItem[] = [];
  const analyses: AnalysisItem[] = [];

  for (const file of session.context.files) {
    if (
      file.metadata?.tool === "context_research_browser" ||
      (file.path.startsWith("context/") && file.path.endsWith(".md"))
    ) {
      research.push({
        path: file.path,
        content: file.content,
        metadata: file.metadata || {},
      });
    }
  }

  const sandboxPath = session.sandboxPath || "./sandbox/default";
  const artifactsDir = join(sandboxPath, "artifacts");

  if (existsSync(artifactsDir)) {
    try {
      const files = await readdir(artifactsDir);

      for (const file of files) {
        if (file.endsWith("_analysis.toml")) {
          const content = await readFile(join(artifactsDir, file), "utf-8");
          analyses.push({
            path: `artifacts/${file}`,
            content,
            parsed: parseYaml(content),
          });
        }
      }
    } catch {
      // Artifacts dir may not have analyses yet
    }
  }

  return { research, analyses };
}

// ── Review logic ─────────────────────────────────────────────

function parseReviewResponse(tomlStr: string): ReviewResult {
  let clean = tomlStr
    .replace(/^```toml?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  const result: ReviewResult = {
    overall_score: 0.5,
    verdict: "acceptable",
    criteria_scores: {
      topic_relevance: 0.5,
      information_quality: 0.5,
      source_credibility: 0.5,
      content_clarity: 0.5,
      context_fit: 0.5,
    },
    item_reviews: [],
    recommendations: { keep: [], remove: [], refine: [] },
    summary: "",
    context_efficiency: {
      total_tokens_estimate: 0,
      recommended_tokens: 0,
      reduction_possible: 0,
    },
  };

  const parsed = parseToml(clean);

  if (parsed.overall_score !== undefined) result.overall_score = parsed.overall_score as number;
  if (parsed.verdict) result.verdict = parsed.verdict as string;
  if (parsed.summary) result.summary = parsed.summary as string;

  if (parsed.criteria_scores) {
    Object.assign(result.criteria_scores, parsed.criteria_scores);
  }

  if (parsed.context_efficiency) {
    Object.assign(result.context_efficiency, parsed.context_efficiency);
  }

  if (parsed.item_reviews && Array.isArray(parsed.item_reviews)) {
    result.item_reviews = parsed.item_reviews as ItemReview[];
  }

  if (parsed.recommendations) {
    const recs = parsed.recommendations as Record<string, unknown>;
    if (recs.keep) result.recommendations.keep = recs.keep as string[];
    if (recs.remove) result.recommendations.remove = recs.remove as string[];
    if (recs.refine) result.recommendations.refine = recs.refine as string[];
  }

  return result;
}

function basicReview(
  research: ResearchItem[],
  analyses: AnalysisItem[],
  _intent: string,
  minRelevancyScore: number
): ReviewResult {
  const itemReviews: ItemReview[] = research.map((r) => {
    const analysis = analyses.find((a) => a.path.includes(basename(r.path, ".md")));

    const contentLength = r.content.length;
    const hasHeadings = (r.content.match(/^#+\s/gm) || []).length;
    const hasCode = (r.content.match(/```/g) || []).length / 2;
    const hasLinks = (r.content.match(/\[.*?\]\(.*?\)/g) || []).length;

    const score = Math.min(
      1,
      (contentLength > 1000 ? 0.3 : contentLength / 3333) +
        (hasHeadings > 3 ? 0.2 : hasHeadings * 0.067) +
        (hasCode > 0 ? 0.2 : 0) +
        (hasLinks > 2 ? 0.15 : hasLinks * 0.075) +
        ((analysis?.parsed?.confidence_score as number) || 0.15)
    );

    return {
      source: r.path,
      score,
      strengths: [
        contentLength > 2000 ? "Substantial content" : null,
        hasHeadings > 3 ? "Well-structured with headings" : null,
        hasCode > 0 ? "Includes code examples" : null,
        hasLinks > 2 ? "Good references" : null,
      ].filter(Boolean) as string[],
      weaknesses: [
        contentLength < 500 ? "Limited content" : null,
        hasHeadings < 2 ? "Lacks structure" : null,
        !analysis ? "Not analyzed" : null,
      ].filter(Boolean) as string[],
      keep: score >= minRelevancyScore,
    };
  });

  const avgScore =
    itemReviews.reduce((sum, r) => sum + r.score, 0) / itemReviews.length || 0.5;

  const verdict =
    avgScore >= 0.8
      ? "excellent"
      : avgScore >= 0.7
        ? "good"
        : avgScore >= 0.6
          ? "acceptable"
          : avgScore >= 0.4
            ? "needs_improvement"
            : "poor";

  return {
    overall_score: avgScore,
    verdict,
    criteria_scores: {
      topic_relevance: avgScore,
      information_quality: avgScore,
      source_credibility: 0.5,
      content_clarity: avgScore,
      context_fit: avgScore,
    },
    item_reviews: itemReviews,
    recommendations: {
      keep: itemReviews.filter((r) => r.keep).map((r) => r.source),
      remove: itemReviews.filter((r) => !r.keep).map((r) => r.source),
      refine: [],
    },
    summary: `Reviewed ${research.length} research items. Average score: ${(avgScore * 100).toFixed(1)}%. ${itemReviews.filter((r) => r.keep).length} items recommended for retention.`,
    context_efficiency: {
      total_tokens_estimate: Math.ceil(
        research.reduce((sum, r) => sum + r.content.length, 0) / 4
      ),
      recommended_tokens: Math.ceil(
        research
          .filter((_, i) => itemReviews[i].keep)
          .reduce((sum, r) => sum + r.content.length, 0) / 4
      ),
      reduction_possible:
        1 - itemReviews.filter((r) => r.keep).length / itemReviews.length,
    },
  };
}

async function reviewWithLLM(
  research: ResearchItem[],
  analyses: AnalysisItem[],
  intent: string,
  llmClient: LLMClient | null,
  evaluationClient: LLMClient | null,
  minRelevancyScore: number
): Promise<ReviewResult> {
  const client = evaluationClient || llmClient;

  if (!client) {
    return basicReview(research, analyses, intent, minRelevancyScore);
  }

  const systemPrompt = `task:
  role: Research Quality Reviewer
  objective: Evaluate research content against stated intent/objectives

evaluation_criteria:
  topic_relevance: weight 0.30 - How well content matches research intent
  information_quality: weight 0.25 - Accuracy, depth, usefulness
  source_credibility: weight 0.15 - Authority and trustworthiness
  content_clarity: weight 0.15 - How clear and well-organized
  context_fit: weight 0.15 - How well it fits broader context

output_format: TOML (resilient to truncation)

TOML_TEMPLATE:
# Research Review Output
overall_score = 0.85
verdict = "good"
summary = "Brief 2-3 sentence assessment"

[criteria_scores]
topic_relevance = 0.90
information_quality = 0.85
source_credibility = 0.75
content_clarity = 0.80
context_fit = 0.80

[context_efficiency]
total_tokens_estimate = 5000
recommended_tokens = 4000
reduction_possible = 0.20

[[item_reviews]]
source = "context/file1.md"
score = 0.85
keep = true
strengths = ["strength1", "strength2"]
weaknesses = ["weakness1"]

[[item_reviews]]
source = "context/file2.md"
score = 0.70
keep = true
strengths = ["strength1"]
weaknesses = ["weakness1", "weakness2"]

[recommendations]
keep = ["context/file1.md", "context/file2.md"]
remove = []

CRITICAL: Output ONLY valid TOML. No markdown blocks, no explanations.`;

  const contentSummary = research
    .map((r, i) => {
      const analysis = analyses.find((a) => a.path.includes(basename(r.path, ".md")));
      return `## Research Item ${i + 1}: ${r.path}
Source: ${(r.metadata?.sourceUrl as string) || "unknown"}
Title: ${(r.metadata?.pageTitle as string) || "untitled"}
${(analysis?.parsed?.summary as string) ? `Summary: ${analysis!.parsed.summary}` : ""}
${Array.isArray(analysis?.parsed?.tags) && analysis!.parsed.tags.length ? `Tags: ${(analysis!.parsed.tags as string[]).join(", ")}` : ""}

Content Preview:
${r.content.slice(0, 2000)}...
`;
    })
    .join("\n---\n");

  const userPrompt = `Research Intent/Objective:
${intent || "General research gathering - evaluate for overall quality and relevance"}

Research Content to Review:
${contentSummary}

Evaluate all research items against the stated intent. Score each item and provide overall assessment.`;

  try {
    const response = await client.send({
      systemPrompt,
      userPrompt,
      parameters: { temperature: 0.2, maxTokens: 4096 },
    });

    return parseReviewResponse(response.content);
  } catch (err) {
    console.error("LLM review failed:", (err as Error).message);
    return basicReview(research, analyses, intent, minRelevancyScore);
  }
}

async function ensureArtifactsDir(sandboxPath: string): Promise<string> {
  const artifactsDir = join(sandboxPath, "artifacts");
  if (!existsSync(artifactsDir)) {
    await mkdir(artifactsDir, { recursive: true });
  }
  return artifactsDir;
}

async function writeReviewArtifact(
  artifactsDir: string,
  review: ReviewResult
): Promise<string> {
  const filepath = join(artifactsDir, "research_review.toml");

  const tomlContent = objectToToml({
    review_metadata: {
      generated_at: new Date().toISOString(),
      tool: "review_research",
      version: "1.0",
    },
    ...review,
  });

  await writeFile(filepath, tomlContent, "utf-8");
  return filepath;
}

// ── Execute entry point ──────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const intent = args.intent as string | undefined;
  const min_score = args.min_score as number | undefined;
  const include_item_reviews = (args.include_item_reviews as boolean) !== false;

  if (!sessionId) return formatError("sessionId is required");

  const session = ctx.config._session as SessionData | undefined;
  if (!session) return formatError(`Session not found: ${sessionId}`);

  const sandboxPath = session.sandboxPath || join("./sandbox", sessionId);
  const artifactsDir = await ensureArtifactsDir(sandboxPath);

  const { research, analyses } = await getResearchData(session);

  if (research.length === 0) {
    return formatError("No research content found to review");
  }

  const minRelevancyScore = min_score ?? (ctx.config.minRelevancyScore as number) ?? DEFAULT_CONFIG.minRelevancyScore;
  const llmClient = (ctx.config.llmClient as LLMClient | undefined) ?? null;
  const evaluationClient = (ctx.config.evaluationClient as LLMClient | undefined) ?? null;

  const review = await reviewWithLLM(
    research,
    analyses,
    intent || "",
    llmClient,
    evaluationClient,
    minRelevancyScore
  );

  const reviewPath = await writeReviewArtifact(artifactsDir, review);

  const response: Record<string, unknown> = {
    success: true,
    overall_score: review.overall_score,
    verdict: review.verdict,
    criteria_scores: review.criteria_scores,
    summary: review.summary,
    recommendations: {
      keep_count: review.recommendations.keep.length,
      remove_count: review.recommendations.remove.length,
      refine_count: review.recommendations.refine.length,
      keep: review.recommendations.keep,
      remove: review.recommendations.remove,
    },
    context_efficiency: review.context_efficiency,
    review_artifact: "artifacts/research_review.toml",
    absolute_path: reviewPath,
  };

  if (include_item_reviews) {
    response.item_reviews = review.item_reviews;
  }

  return formatResponse(response);
}

// ── Tool Definition ─────────────────────────────────────────

const reviewResearchTool: Tool = {
  name: "review_research",
  description: `Review and score all research content against original intent from context_research_browser.

USE CASES:
- Validate research relevancy before context inclusion
- Score research quality and credibility
- Get recommendations for context window optimization
- Identify research items to keep, remove, or refine

WORKFLOW:
1. Retrieves all research from session context
2. Loads any existing analysis artifacts
3. Evaluates against stated intent/objective
4. Scores using weighted criteria:
   - Topic Relevance (30%)
   - Information Quality (25%)
   - Source Credibility (15%)
   - Content Clarity (15%)
   - Context Fit (15%)
5. Generates recommendations
6. Exports research_review.toml artifact

EVALUATION MODEL:
- Uses evaluation_client if configured (separate provider/model)
- Falls back to default llmClient
- Works without LLM (basic heuristic scoring)

OUTPUT:
- overall_score: 0-1 weighted average
- verdict: excellent/good/acceptable/needs_improvement/poor
- criteria_scores: breakdown by criterion
- item_reviews: per-item scores and feedback
- recommendations: keep/remove/refine lists
- context_efficiency: token estimates and reduction potential

ARTIFACT:
- artifacts/research_review.toml - Complete review with all scores and recommendations`,
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID (required)",
      },
      intent: {
        type: "string",
        description: "Original research intent/objective to evaluate against",
      },
      min_score: {
        type: "number",
        minimum: 0,
        maximum: 1,
        default: 0.6,
        description: "Minimum relevancy score to recommend keeping (0-1)",
      },
      include_item_reviews: {
        type: "boolean",
        default: true,
        description: "Include per-item review details in response",
      },
    },
    required: ["sessionId"],
  },
  execute,
};

export default reviewResearchTool;
