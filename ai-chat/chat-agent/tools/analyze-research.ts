import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, basename, extname } from "path";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// -- Types --------------------------------------------------------------------

interface ResearchItem {
  path: string;
  content: string;
  metadata: Record<string, unknown>;
  size: number;
}

interface AnalysisResult {
  title: string;
  summary: string;
  tags: string[];
  key_concepts: string[];
  relevant_information: RelevantInfo[];
  clarity_improvements: ClarityImprovement[];
  confidence_score: number;
  needs_refinement: boolean;
  source?: SourceMetadata;
}

interface RelevantInfo {
  heading: string;
  content: string;
  relevance_score: number;
}

interface ClarityImprovement {
  original: string;
  improved: string;
}

interface SourceMetadata {
  path: string;
  url?: string;
  fetched_at?: string;
  analyzed_at: string;
  iterations: number;
}

interface SessionData {
  sandboxPath?: string;
  context?: {
    files?: SessionFile[];
  };
}

interface SessionFile {
  path: string;
  content: string;
  metadata?: Record<string, unknown>;
  size: number;
}

interface LLMClient {
  send(params: {
    systemPrompt: string;
    userPrompt: string;
    parameters: { temperature: number; maxTokens: number };
  }): Promise<{ content: string }>;
}

interface SessionManager {
  getSession(sessionId: string): SessionData | null;
}

// -- Constants ----------------------------------------------------------------

const DEFAULT_MAX_ITERATIONS = 3;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_MAX_CONTENT_LENGTH = 100_000;

// -- Helpers ------------------------------------------------------------------

async function ensureArtifactsDir(sandboxPath: string): Promise<string> {
  const artifactsDir = join(sandboxPath, "artifacts");
  if (!existsSync(artifactsDir)) {
    await mkdir(artifactsDir, { recursive: true });
  }
  return artifactsDir;
}

function getResearchContent(
  sessionManager: SessionManager,
  sessionId: string,
  sourcePath: string | null = null
): ResearchItem[] {
  const session = sessionManager.getSession(sessionId);
  if (!session?.context?.files) return [];

  const researchFiles = session.context.files.filter((file) => {
    if (sourcePath && file.path !== sourcePath) return false;
    return (
      file.metadata?.tool === "context_research_browser" ||
      (file.path.startsWith("context/") && file.path.endsWith(".md"))
    );
  });

  return researchFiles.map((file) => ({
    path: file.path,
    content: file.content,
    metadata: file.metadata || {},
    size: file.size,
  }));
}

function extractFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatterStr = match[1];
  const body = content.slice(match[0].length).trim();

  const frontmatter: Record<string, string> = {};
  for (const line of frontmatterStr.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

// -- TOML Helpers -------------------------------------------------------------

function parseTomlValue(value: string): unknown {
  // String (double or single quoted)
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  // Boolean
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

function parseTomlResponse(tomlStr: string): AnalysisResult {
  // Clean up potential markdown artifacts
  const clean = tomlStr
    .replace(/^```toml?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  const result: AnalysisResult = {
    title: "",
    summary: "",
    tags: [],
    key_concepts: [],
    relevant_information: [],
    clarity_improvements: [],
    confidence_score: 0.5,
    needs_refinement: true,
  };

  let currentArraySection: string | null = null;
  let currentArrayItem: Record<string, unknown> | null = null;

  const lines = clean.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Array of tables: [[section]]
    const arrayMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayMatch) {
      // Save previous array item
      if (currentArrayItem && currentArraySection) {
        const arr = (result as unknown as Record<string, unknown[]>)[currentArraySection];
        if (Array.isArray(arr)) arr.push(currentArrayItem);
      }
      currentArraySection = arrayMatch[1].trim();
      currentArrayItem = {};
      continue;
    }

    // Regular section (skip, we handle flat structure)
    if (trimmed.match(/^\[[^\]]+\]$/)) {
      if (currentArrayItem && currentArraySection) {
        const arr = (result as unknown as Record<string, unknown[]>)[currentArraySection];
        if (Array.isArray(arr)) arr.push(currentArrayItem);
        currentArrayItem = null;
        currentArraySection = null;
      }
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
      } else if (key in result) {
        (result as unknown as Record<string, unknown>)[key] = parsedValue;
      }
    }
  }

  // Save final array item
  if (currentArrayItem && currentArraySection) {
    const arr = (result as unknown as Record<string, unknown[]>)[currentArraySection];
    if (Array.isArray(arr)) arr.push(currentArrayItem);
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
  const lines: string[] = ["# Research Analysis Output"];
  const sections: { key: string; obj: Record<string, unknown> }[] = [];
  const arrayTables: { key: string; items: Record<string, unknown>[] }[] = [];

  // First pass: collect top-level values, sections, and array tables
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

  // Add sections
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

  // Add array of tables
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

// -- Analysis -----------------------------------------------------------------

function basicAnalysis(
  content: string,
  existingMetadata: Record<string, unknown>
): AnalysisResult {
  // Extract headings as tags
  const headings = content.match(/^#{1,3}\s+(.+)$/gm) || [];
  const tags = headings.map((h) =>
    h
      .replace(/^#+\s*/, "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
  );

  // Extract code blocks as relevant info
  const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
  const relevantInfo: RelevantInfo[] = codeBlocks.slice(0, 5).map((block, i) => ({
    heading: `Code Example ${i + 1}`,
    content: block.slice(0, 500),
    relevance_score: 0.6,
  }));

  // Word frequency for concepts
  const words = content.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const freq: Record<string, number> = {};
  words.forEach((w) => {
    freq[w] = (freq[w] || 0) + 1;
  });
  const concepts = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);

  return {
    title:
      (existingMetadata.pageTitle as string) ||
      (existingMetadata.title as string) ||
      "Untitled Research",
    summary: content.slice(0, 200).replace(/\n/g, " ") + "...",
    tags: [...new Set(tags)].slice(0, 15),
    key_concepts: concepts,
    relevant_information: relevantInfo,
    clarity_improvements: [],
    confidence_score: 0.5,
    needs_refinement: false,
  };
}

async function analyzeWithLLM(
  content: string,
  existingMetadata: Record<string, unknown>,
  iteration: number,
  llmClient: LLMClient | null,
  maxContentLength: number
): Promise<AnalysisResult> {
  if (!llmClient) {
    return basicAnalysis(content, existingMetadata);
  }

  const systemPrompt = `task:
  role: Research Content Analyzer
  objective: Extract structured metadata from research content
  iteration: ${iteration}

output_format: TOML (resilient to truncation)

TOML_TEMPLATE:
# Research Analysis
title = "Document Title"
summary = "2-3 sentence summary of the content"
confidence_score = 0.85
needs_refinement = false

tags = ["tag1", "tag2", "tag3", "tag4", "tag5"]
key_concepts = ["concept1", "concept2", "concept3"]

[[relevant_information]]
heading = "Section Title"
content = "Key excerpt from this section"
relevance_score = 0.9

[[relevant_information]]
heading = "Another Section"
content = "Another key excerpt"
relevance_score = 0.8

[[clarity_improvements]]
original = "unclear text from source"
improved = "clearer rewrite of the text"

instructions:
  - Extract 5-15 meaningful tags that categorize the content
  - Identify key concepts and terminology
  - Pull out the most relevant information sections
  - Suggest clarity improvements for unclear passages
  - Rate your confidence in the analysis (0-1)
  - Set needs_refinement = true if confidence < 0.7

CRITICAL: Output ONLY valid TOML. No markdown blocks, no explanations.`;

  const userPrompt = `Analyze this research content:

${existingMetadata.title ? `Title: ${existingMetadata.title}` : ""}
${existingMetadata.url ? `Source: ${existingMetadata.url}` : ""}

Content:
${content.slice(0, maxContentLength)}`;

  try {
    const response = await llmClient.send({
      systemPrompt,
      userPrompt,
      parameters: { temperature: 0.3, maxTokens: 4096 },
    });

    return parseTomlResponse(response.content);
  } catch (err: any) {
    console.error("LLM analysis failed:", err.message);
    return basicAnalysis(content, existingMetadata);
  }
}

async function writeAnalysisToml(
  artifactsDir: string,
  sourceName: string,
  analysis: AnalysisResult
): Promise<string> {
  const filename = `${sourceName}_analysis.toml`;
  const filepath = join(artifactsDir, filename);
  const tomlContent = objectToToml(analysis as unknown as Record<string, unknown>);
  await writeFile(filepath, tomlContent, "utf-8");
  return filepath;
}

async function writeRawResearch(
  artifactsDir: string,
  researchItems: ResearchItem[]
): Promise<string> {
  const filepath = join(artifactsDir, "raw_research.md");

  const content = researchItems
    .map((item) => {
      return (
        `# ${(item.metadata.pageTitle as string) || item.path}\n\n` +
        `> Source: ${(item.metadata.sourceUrl as string) || "unknown"}\n` +
        `> Fetched: ${(item.metadata.fetchedAt as string) || "unknown"}\n\n` +
        item.content +
        "\n\n---\n"
      );
    })
    .join("\n");

  await writeFile(filepath, content, "utf-8");
  return filepath;
}

// -- Execute ------------------------------------------------------------------

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const sourcePath = (args.source_path as string) ?? null;
  const maxIterationsArg = args.max_iterations as number | undefined;
  const includeRaw = (args.include_raw as boolean) ?? true;

  const sessionManager = ctx.config.sessionManager as SessionManager | undefined;
  const llmClient = (ctx.config.llmClient as LLMClient) ?? null;
  const maxIterations = maxIterationsArg ?? (ctx.config.maxIterations as number) ?? DEFAULT_MAX_ITERATIONS;
  const confidenceThreshold =
    (ctx.config.confidenceThreshold as number) ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const maxContentLength =
    (ctx.config.maxContentLength as number) ?? DEFAULT_MAX_CONTENT_LENGTH;

  if (!sessionId) return formatError("sessionId is required");
  if (!sessionManager) return formatError("sessionManager is not configured");

  const sessionData = sessionManager.getSession(sessionId);
  if (!sessionData) return formatError(`Session not found: ${sessionId}`);

  const sandboxPath = sessionData.sandboxPath || join("./sandbox", sessionId);
  const artifactsDir = await ensureArtifactsDir(sandboxPath);

  // Get research content
  const researchItems = getResearchContent(sessionManager, sessionId, sourcePath);
  if (researchItems.length === 0) {
    return formatError("No research content found in session context");
  }

  const results: Record<string, unknown>[] = [];

  // Analyze each research item
  for (const item of researchItems) {
    const { frontmatter, body } = extractFrontmatter(item.content);

    let analysis: AnalysisResult | null = null;
    let iteration = 0;

    // Iterative refinement loop
    while (iteration < maxIterations) {
      iteration++;
      analysis = await analyzeWithLLM(
        body,
        { ...frontmatter, ...item.metadata },
        iteration,
        llmClient,
        maxContentLength
      );

      if (!analysis.needs_refinement || analysis.confidence_score >= confidenceThreshold) {
        break;
      }
    }

    // Add source metadata
    analysis!.source = {
      path: item.path,
      url: (item.metadata.sourceUrl as string) || (frontmatter.url as string),
      fetched_at: (item.metadata.fetchedAt as string) || (frontmatter.fetched_at as string),
      analyzed_at: new Date().toISOString(),
      iterations: iteration,
    };

    // Generate source name for file
    const sourceName = basename(item.path, extname(item.path))
      .replace(/[^a-zA-Z0-9-_]/g, "_")
      .slice(0, 50);

    // Write analysis TOML
    const tomlPath = await writeAnalysisToml(artifactsDir, sourceName, analysis!);

    results.push({
      source: item.path,
      analysis_file: `artifacts/${sourceName}_analysis.toml`,
      absolute_path: tomlPath,
      iterations: iteration,
      confidence: analysis!.confidence_score,
      tags_count: analysis!.tags.length,
      concepts_count: analysis!.key_concepts.length,
    });
  }

  // Write raw research clone
  let rawResearchPath: string | null = null;
  if (includeRaw) {
    rawResearchPath = await writeRawResearch(artifactsDir, researchItems);
  }

  return formatResponse({
    success: true,
    analyzed_count: results.length,
    results,
    raw_research_path: rawResearchPath ? "artifacts/raw_research.md" : null,
    artifacts_directory: "artifacts/",
    message: `Analyzed ${results.length} research item(s)`,
  });
}

// -- Tool Definition ----------------------------------------------------------

const analyzeResearchTool: Tool = {
  name: "analyze_research",
  description: `Analyze research content from context_research_browser tool with iterative LLM-powered refinement.

USE CASES:
- Extract structured metadata from research documents
- Generate tags and categorization for research content
- Identify key concepts and relevant information
- Improve clarity of research excerpts
- Create analysis artifacts for toolchain context

WORKFLOW:
1. Retrieves research content from session context
2. Iteratively analyzes with LLM (up to max_iterations)
3. Extracts tags, concepts, and relevant sections
4. Generates TOML analysis file per research item
5. Creates raw_research.md clone for debugging

OUTPUT ARTIFACTS:
- {source}_analysis.toml - Structured TOML with:
  - title, summary, tags, key_concepts
  - relevant_information (scored excerpts)
  - clarity_improvements (suggested rewrites)
  - confidence_score, source metadata
- raw_research.md - Combined raw content for debug/context

ANALYSIS FIELDS:
- tags: Topic categorization (5-15 tags)
- key_concepts: Main terminology and concepts
- relevant_information: Scored content excerpts
- clarity_improvements: Suggested rewrites
- confidence_score: Analysis confidence (0-1)`,
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID (required)",
      },
      source_path: {
        type: "string",
        description:
          "Specific research file path to analyze (optional, analyzes all if omitted)",
      },
      max_iterations: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        default: 3,
        description: "Maximum refinement iterations per item",
      },
      include_raw: {
        type: "boolean",
        default: true,
        description: "Include raw_research.md clone in artifacts",
      },
    },
    required: ["sessionId"],
  },
  execute,
};

export default analyzeResearchTool;
