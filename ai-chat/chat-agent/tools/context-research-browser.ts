import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// -- Types --------------------------------------------------------------------

interface PipelineConfig {
  maxUrls: number;
  chunkSize: number;
  minRelevanceScore: number;
  parallelFetches: number;
}

interface DefaultConfig {
  timeout: number;
  waitFor: string;
  maxContentLength: number;
  removeSelectors: string[];
  pipeline: PipelineConfig;
}

interface GatherResult {
  url: string;
  title: string | null;
  content: string | null;
  error: string | null;
}

interface ValidatedChunk extends GatherResult {
  relevance: number;
  relevanceReason?: string;
}

interface Finding {
  topic: string;
  details?: string;
  finding?: string;
  sources?: string[];
  importance: string;
}

interface AnalysisResult {
  summary: string;
  tags: string[];
  key_concepts: string[];
  key_findings?: Finding[];
  findings?: Finding[];
}

interface ActionableInsight {
  insight: string;
  application: string;
}

interface SynthesisResult extends AnalysisResult {
  synthesis?: string;
  actionable_insights?: ActionableInsight[];
  sources?: { url: string; title: string | null; relevance: number }[];
}

interface PipelineStats {
  urls_requested: number;
  urls_fetched: number;
  urls_validated: number;
  findings_count: number;
  duration: number;
}

interface PipelineResult extends SynthesisResult {
  success: boolean;
  error?: string;
  pipeline_stats?: PipelineStats;
  duration?: number;
  report_path?: string;
  session_note?: string | null;
}

interface ValidationScore {
  index: number;
  relevance: number;
  reason: string;
}

interface ContextFile {
  path: string;
  content: string;
  type: string;
  size: number;
  contentHash: string;
  metadata: Record<string, string>;
}

interface LLMClient {
  send(opts: {
    systemPrompt: string;
    userPrompt: string;
    parameters: { temperature: number; maxTokens: number };
  }): Promise<{ content: string }>;
}

interface SessionManager {
  getSession(id: string): any;
  store: { update(id: string, data: any): void };
  getToolTimeout(id: string, toolName: string): number;
  recordTimeoutEvent(id: string, toolName: string, timedOut: boolean, duration: number): void;
}

// Playwright types are not imported to keep the dynamic import pattern.
type PlaywrightBrowser = any;

// -- Default Config -----------------------------------------------------------

const DEFAULT_CONFIG: DefaultConfig = {
  timeout: 60000,
  waitFor: "domcontentloaded",
  maxContentLength: 500000,
  removeSelectors: [
    "script", "style", "noscript", "iframe", "svg",
    "nav", "footer", "header", "aside",
    ".advertisement", ".ad", ".ads", ".sidebar",
    "#cookie-banner", ".cookie-notice", ".popup",
  ],
  pipeline: {
    maxUrls: 5,
    chunkSize: 15000,
    minRelevanceScore: 0.4,
    parallelFetches: 3,
  },
};

// -- Module State -------------------------------------------------------------

let browser: PlaywrightBrowser | null = null;
let pw: any = null;
let llmClient: LLMClient | null = null;
let sessionManager: SessionManager | null = null;
let allowedHosts: string[] = ["*"];
let configTimeout = DEFAULT_CONFIG.timeout;
let configWaitFor = DEFAULT_CONFIG.waitFor;
let configMaxContentLength = DEFAULT_CONFIG.maxContentLength;
let configRemoveSelectors = DEFAULT_CONFIG.removeSelectors;
let analysisMaxContentLength = 100000;

// -- HTML to Markdown ---------------------------------------------------------

function htmlToMarkdown(html: string): string {
  let md = html;

  // Remove script and style tags with content
  md = md.replace(/<script[\s\S]*?<\/script>/gi, "");
  md = md.replace(/<style[\s\S]*?<\/style>/gi, "");
  md = md.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

  // Convert headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n\n");
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n\n");
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n\n");

  // Convert formatting
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
  md = md.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, "_$1_");
  md = md.replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, "~~$1~~");
  md = md.replace(/<strike[^>]*>([\s\S]*?)<\/strike>/gi, "~~$1~~");
  md = md.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, "~~$1~~");
  md = md.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, "==$1==");

  // Convert code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n```\n$1\n```\n");
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");

  // Convert links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Convert images
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)");
  md = md.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, "![$1]($2)");
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, "![]($1)");

  // Convert lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_match: string, content: string) => {
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  });
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_match: string, content: string) => {
    let i = 0;
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => `${++i}. $1\n`);
  });

  // Convert blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match: string, content: string) => {
    return content.split("\n").map((line: string) => `> ${line}`).join("\n") + "\n";
  });

  // Convert paragraphs and line breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Convert tables (basic support)
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_match: string, content: string) => {
    let result = "\n";
    const rows = content.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];

    rows.forEach((row: string, idx: number) => {
      const cells = row.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || [];
      const cellContents = cells.map((cell: string) =>
        cell.replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/i, "$1").trim()
      );

      result += "| " + cellContents.join(" | ") + " |\n";

      // Add header separator after first row
      if (idx === 0) {
        result += "| " + cellContents.map(() => "---").join(" | ") + " |\n";
      }
    });

    return result + "\n";
  });

  // Convert definition lists
  md = md.replace(/<dl[^>]*>([\s\S]*?)<\/dl>/gi, (_match: string, content: string) => {
    let result = content;
    result = result.replace(/<dt[^>]*>([\s\S]*?)<\/dt>/gi, "\n**$1**\n");
    result = result.replace(/<dd[^>]*>([\s\S]*?)<\/dd>/gi, ": $1\n");
    return result;
  });

  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  md = md.replace(/&nbsp;/g, " ");
  md = md.replace(/&amp;/g, "&");
  md = md.replace(/&lt;/g, "<");
  md = md.replace(/&gt;/g, ">");
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&copy;/g, "\u00A9");
  md = md.replace(/&reg;/g, "\u00AE");
  md = md.replace(/&trade;/g, "\u2122");
  md = md.replace(/&#(\d+);/g, (_match: string, dec: string) => String.fromCharCode(Number(dec)));

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, "\n\n");
  md = md.replace(/[ \t]+/g, " ");
  md = md.replace(/^\s+|\s+$/gm, "");

  return md.trim();
}

// -- URL Helpers --------------------------------------------------------------

function urlToFilename(url: string): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const lastPart = pathParts.pop() || parsed.hostname;

    let filename = lastPart
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 50);

    if (!filename) {
      filename = parsed.hostname.replace(/\./g, "-");
    }

    return `${filename}.md`;
  } catch {
    return "research-content.md";
  }
}

function isHostAllowed(hostname: string): boolean {
  if (allowedHosts.includes("*")) return true;

  for (const pattern of allowedHosts) {
    if (pattern.startsWith("*.")) {
      const domain = pattern.slice(2);
      if (hostname === domain || hostname.endsWith("." + domain)) {
        return true;
      }
    } else if (hostname === pattern) {
      return true;
    }
  }
  return false;
}

// -- Browser ------------------------------------------------------------------

async function getBrowser(): Promise<PlaywrightBrowser> {
  if (browser) return browser;

  if (!pw) {
    try {
      pw = await import("playwright");
    } catch {
      throw new Error("Playwright is not installed. Run: bun add playwright");
    }
  }

  const { chromium } = pw;
  browser = await chromium.launch({ headless: true });
  return browser;
}

async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// -- TOML Parsing Helpers -----------------------------------------------------

function parseTomlValue(value: string): any {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;

  if (value.startsWith("[")) {
    try {
      const inner = value.slice(1, -1).trim();
      if (!inner) return [];
      const items: any[] = [];
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

  if (/^-?\d*\.?\d+$/.test(value)) {
    return parseFloat(value);
  }

  return value;
}

function parseTomlResponse(tomlStr: string): AnalysisResult {
  const clean = tomlStr
    .replace(/^```toml?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  const result: Record<string, any> = {
    summary: "",
    tags: [],
    key_concepts: [],
    key_findings: [],
  };

  let currentArraySection: string | null = null;
  let currentArrayItem: Record<string, any> | null = null;

  for (const line of clean.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Array of tables: [[section]]
    const arrayMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayMatch) {
      if (currentArrayItem && currentArraySection) {
        if (!result[currentArraySection]) result[currentArraySection] = [];
        result[currentArraySection].push(currentArrayItem);
      }
      currentArraySection = arrayMatch[1].trim();
      currentArrayItem = {};
      continue;
    }

    // Regular section (end array mode)
    if (trimmed.match(/^\[[^\]]+\]$/)) {
      if (currentArrayItem && currentArraySection) {
        if (!result[currentArraySection]) result[currentArraySection] = [];
        result[currentArraySection].push(currentArrayItem);
        currentArrayItem = null;
        currentArraySection = null;
      }
      continue;
    }

    // Key-value pair
    const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const value = parseTomlValue(kvMatch[2].trim());

      if (currentArrayItem) {
        currentArrayItem[key] = value;
      } else if (Object.prototype.hasOwnProperty.call(result, key)) {
        result[key] = value;
      }
    }
  }

  // Save final array item
  if (currentArrayItem && currentArraySection) {
    if (!result[currentArraySection]) result[currentArraySection] = [];
    result[currentArraySection].push(currentArrayItem);
  }

  return result as AnalysisResult;
}

// -- Analysis -----------------------------------------------------------------

async function analyzeContent(
  content: string,
  metadata: { title?: string; url?: string },
  intent: string | null = null
): Promise<AnalysisResult> {
  if (!llmClient) {
    return basicAnalysis(content, metadata);
  }

  const intentSection = intent
    ? `\nRESEARCH INTENT: ${intent}\nFocus your analysis on extracting information relevant to this intent. Prioritize findings that directly address this objective.\n`
    : "";

  const systemPrompt = `task:
  role: Research Content Analyzer
  objective: Extract structured insights from research content
${intentSection}
output_format: TOML (resilient to truncation)

TOML_TEMPLATE:
# Research Analysis
summary = "2-3 sentence summary directly addressing the research intent and key findings"

tags = ["tag1", "tag2", "tag3", "tag4", "tag5"]
key_concepts = ["concept1", "concept2", "concept3"]

[[key_findings]]
topic = "Topic Area"
finding = "Specific factual finding with details, examples, or data points extracted from the content"
importance = "high"

[[key_findings]]
topic = "Another Topic"
finding = "Another detailed finding with concrete information"
importance = "medium"

instructions:
  - Write a summary that directly addresses the research intent (if provided)
  - Extract 5-10 meaningful tags that categorize the content
  - Identify key concepts, terminology, and technical terms (5-10 items)
  - Extract 5-10 key findings with SPECIFIC details, not vague statements
  - Each finding should contain concrete facts, examples, numbers, or techniques
  - Rate importance based on relevance to the research intent
  - Focus on extracting actionable, specific information rather than general observations

CRITICAL: Output ONLY valid TOML. No markdown blocks, no explanations.`;

  const intentPrompt = intent ? `\nResearch Intent: ${intent}\n` : "";
  const userPrompt = `Analyze this research content:

Title: ${metadata.title || "Unknown"}
Source: ${metadata.url || "Unknown"}
${intentPrompt}
Content:
${content.slice(0, analysisMaxContentLength)}`;

  try {
    const response = await llmClient.send({
      systemPrompt,
      userPrompt,
      parameters: { temperature: 0.3, maxTokens: 2048 },
    });

    return parseTomlResponse(response.content);
  } catch (err: any) {
    console.error("LLM analysis failed:", err.message);
    return basicAnalysis(content, metadata);
  }
}

function basicAnalysis(
  content: string,
  _metadata: { title?: string; url?: string }
): AnalysisResult {
  // Extract headings as tags
  const headings = content.match(/^#{1,3}\s+(.+)$/gm) || [];
  const tags = headings
    .map((h) => h.replace(/^#+\s*/, "").toLowerCase().replace(/[^a-z0-9-]/g, "-"))
    .filter(Boolean);

  // Word frequency for concepts
  const words = content.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const freq: Record<string, number> = {};
  words.forEach((w) => {
    freq[w] = (freq[w] || 0) + 1;
  });
  const concepts = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);

  // Extract first paragraph as summary
  const paragraphs = content
    .split(/\n\n+/)
    .filter((p) => p.trim() && !p.startsWith("#") && !p.startsWith(">"));
  const summary =
    (paragraphs[0]?.slice(0, 300)?.replace(/\n/g, " ") + "...") || "No summary available";

  // Create basic findings from headings
  const findings: Finding[] = headings.slice(0, 5).map((h, i) => ({
    topic: h.replace(/^#+\s*/, ""),
    finding: `Section covering ${h.replace(/^#+\s*/, "")}`,
    importance: i < 2 ? "high" : "medium",
  }));

  return {
    summary,
    tags: [...new Set(tags)].slice(0, 10),
    key_concepts: concepts,
    key_findings: findings,
  };
}

// -- Pipeline Phases ----------------------------------------------------------

async function gatherPhase(
  urls: string[],
  _sessionId: string,
  timeout: number
): Promise<GatherResult[]> {
  const chunkSize = DEFAULT_CONFIG.pipeline.chunkSize;
  const parallelFetches = DEFAULT_CONFIG.pipeline.parallelFetches;

  const results: GatherResult[] = [];
  const b = await getBrowser();

  // Process URLs in batches to limit concurrency
  for (let i = 0; i < urls.length; i += parallelFetches) {
    const batch = urls.slice(i, i + parallelFetches);
    const batchPromises = batch.map(async (url): Promise<GatherResult> => {
      const context = await b.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: "Mozilla/5.0 (compatible; YayAgent Research Bot/1.0)",
      });

      try {
        const page = await context.newPage();
        page.setDefaultTimeout(timeout);

        await page.goto(url, {
          waitUntil: configWaitFor,
          timeout,
        });

        // Remove noise elements
        for (const sel of configRemoveSelectors) {
          try {
            await page.evaluate((s: string) => {
              document.querySelectorAll(s).forEach((el: Element) => el.remove());
            }, sel);
          } catch {
            /* selector might not exist */
          }
        }

        const pageTitle = await page.title();

        // Extract main content
        let html: string = await page.evaluate(() => {
          const selectors = ["main", "article", '[role="main"]', ".content", "#content"];
          for (const s of selectors) {
            const el = document.querySelector(s);
            if (el) return el.innerHTML;
          }
          return document.body.innerHTML;
        });

        let content = htmlToMarkdown(html);

        // Truncate to chunk size for pipeline efficiency
        if (content.length > chunkSize) {
          content = content.slice(0, chunkSize) + "\n\n[...content truncated for pipeline...]";
        }

        return { url, title: pageTitle, content, error: null };
      } catch (err: any) {
        return { url, title: null, content: null, error: err.message };
      } finally {
        await context.close();
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results;
}

async function validatePhase(
  gathered: GatherResult[],
  intent: string
): Promise<ValidatedChunk[]> {
  if (!llmClient) {
    // Without LLM, pass through all non-error results
    return gathered
      .filter((g) => !g.error)
      .map((g) => ({ ...g, relevance: 0.7 }));
  }

  const validChunks = gathered.filter((g) => !g.error && g.content);
  if (validChunks.length === 0) return [];

  // Build batched prompt with all chunks
  const chunksText = validChunks
    .map(
      (chunk, i) =>
        `[SOURCE ${i + 1}]\nURL: ${chunk.url}\nTitle: ${chunk.title}\nContent:\n${chunk.content!.slice(0, 5000)}\n`
    )
    .join("\n---\n");

  const systemPrompt = `You are a research relevance scorer. Given a research intent and multiple content sources, score each source's relevance from 0.0 to 1.0.

Output ONLY valid TOML with scores for each source:

[[source]]
index = 1
relevance = 0.85
reason = "Directly addresses the topic"

[[source]]
index = 2
relevance = 0.3
reason = "Tangentially related"`;

  const userPrompt = `RESEARCH INTENT: ${intent}

Score the relevance of each source to this intent:

${chunksText}`;

  try {
    const response = await llmClient.send({
      systemPrompt,
      userPrompt,
      parameters: { temperature: 0.2, maxTokens: 1024 },
    });

    const scores = parseValidationResponse(response.content, validChunks.length);

    // Apply scores and filter by minimum relevance
    const minScore = DEFAULT_CONFIG.pipeline.minRelevanceScore;
    return validChunks
      .map((chunk, i) => ({
        ...chunk,
        relevance: scores[i]?.relevance || 0.5,
        relevanceReason: scores[i]?.reason || "Default score",
      }))
      .filter((chunk) => chunk.relevance >= minScore);
  } catch (err: any) {
    console.error("Validation phase LLM error:", err.message);
    // Fallback: return all with default score
    return validChunks.map((g) => ({ ...g, relevance: 0.6 }));
  }
}

function parseValidationResponse(tomlStr: string, _expectedCount: number): ValidationScore[] {
  const scores: ValidationScore[] = [];
  const clean = tomlStr
    .replace(/^```toml?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  let currentItem: ValidationScore | null = null;
  for (const line of clean.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "[[source]]") {
      if (currentItem) scores.push(currentItem);
      currentItem = { index: scores.length + 1, relevance: 0.5, reason: "" };
      continue;
    }
    if (currentItem) {
      const match = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        if (key === "relevance") {
          currentItem.relevance = parseFloat(value) || 0.5;
        } else if (key === "reason") {
          currentItem.reason = value.replace(/^["']|["']$/g, "");
        } else if (key === "index") {
          currentItem.index = parseInt(value) || currentItem.index;
        }
      }
    }
  }
  if (currentItem) scores.push(currentItem);

  // Sort by index and return
  return scores.sort((a, b) => a.index - b.index);
}

async function analyzePhase(
  validated: ValidatedChunk[],
  intent: string
): Promise<AnalysisResult> {
  if (!llmClient || validated.length === 0) {
    return basicBatchAnalysis(validated);
  }

  // Combine validated chunks, prioritizing by relevance
  const sorted = [...validated].sort((a, b) => b.relevance - a.relevance);
  const combinedContent = sorted
    .map(
      (v) =>
        `## From: ${v.title} (relevance: ${v.relevance.toFixed(2)})\n${v.content!.slice(0, 8000)}`
    )
    .join("\n\n---\n\n");

  const systemPrompt = `You are a research analyst. Extract structured findings from the provided content based on the research intent.

Output ONLY valid TOML:

summary = "2-3 sentence summary addressing the research intent"

tags = ["tag1", "tag2", "tag3"]
key_concepts = ["concept1", "concept2", "concept3"]

[[findings]]
topic = "Topic name"
details = "Specific finding with concrete details, examples, or data"
sources = ["source title 1"]
importance = "high"

[[findings]]
topic = "Another topic"
details = "Another specific finding"
sources = ["source title 2"]
importance = "medium"

INSTRUCTIONS:
- Focus findings on what's relevant to the research intent
- Include 5-10 specific, detailed findings
- Each finding should have concrete information, not vague statements
- Tag importance as high/medium/low based on relevance to intent`;

  const userPrompt = `RESEARCH INTENT: ${intent}

VALIDATED RESEARCH CONTENT:
${combinedContent}`;

  try {
    const response = await llmClient.send({
      systemPrompt,
      userPrompt,
      parameters: { temperature: 0.3, maxTokens: 3000 },
    });

    return parseAnalysisResponse(response.content);
  } catch (err: any) {
    console.error("Analysis phase LLM error:", err.message);
    return basicBatchAnalysis(validated);
  }
}

function parseAnalysisResponse(tomlStr: string): AnalysisResult {
  const result: AnalysisResult = {
    summary: "",
    tags: [],
    key_concepts: [],
    findings: [],
  };

  const clean = tomlStr
    .replace(/^```toml?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
  let currentFinding: Record<string, any> | null = null;

  for (const line of clean.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed === "[[findings]]") {
      if (currentFinding) result.findings!.push(currentFinding as Finding);
      currentFinding = { topic: "", details: "", sources: [], importance: "medium" };
      continue;
    }

    const match = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      const parsed = parseTomlValue(value);

      if (currentFinding) {
        currentFinding[key] = parsed;
      } else if (key in result) {
        (result as any)[key] = parsed;
      }
    }
  }
  if (currentFinding) result.findings!.push(currentFinding as Finding);

  return result;
}

function basicBatchAnalysis(validated: ValidatedChunk[]): AnalysisResult {
  const allContent = validated.map((v) => v.content).join("\n\n");
  const headings = allContent.match(/^#{1,3}\s+(.+)$/gm) || [];
  const tags = headings
    .map((h) => h.replace(/^#+\s*/, "").toLowerCase().replace(/[^a-z0-9-]/g, "-"))
    .filter(Boolean);

  return {
    summary: `Research gathered from ${validated.length} sources.`,
    tags: [...new Set(tags)].slice(0, 10),
    key_concepts: [],
    findings: validated.map((v) => ({
      topic: v.title || v.url,
      details: (v.content || "").slice(0, 200) + "...",
      sources: [v.url],
      importance: v.relevance > 0.7 ? "high" : "medium",
    })),
  };
}

async function synthesizePhase(
  analysis: AnalysisResult,
  validated: ValidatedChunk[],
  intent: string
): Promise<SynthesisResult> {
  if (!llmClient) {
    return {
      ...analysis,
      synthesis: analysis.summary,
      sources: validated.map((v) => ({ url: v.url, title: v.title, relevance: v.relevance })),
    };
  }

  const findings = analysis.findings || analysis.key_findings || [];
  const findingsText = findings
    .map((f, i) => `${i + 1}. [${f.importance}] ${f.topic}: ${f.details || f.finding || ""}`)
    .join("\n");

  const systemPrompt = `You are a research synthesizer. Create a cohesive summary that addresses the research intent using the extracted findings.

Output ONLY valid TOML:

synthesis = """
A comprehensive 2-4 paragraph synthesis that:
- Directly addresses the research intent
- Integrates key findings into a coherent narrative
- Highlights the most important discoveries
- Notes any gaps or areas needing further research
"""

[[actionable_insights]]
insight = "Specific actionable insight"
application = "How to apply this"

[[actionable_insights]]
insight = "Another insight"
application = "How to apply this"`;

  const userPrompt = `RESEARCH INTENT: ${intent}

EXTRACTED FINDINGS:
${findingsText}

KEY CONCEPTS: ${analysis.key_concepts.join(", ")}

Synthesize these findings into a cohesive response to the research intent.`;

  try {
    const response = await llmClient.send({
      systemPrompt,
      userPrompt,
      parameters: { temperature: 0.4, maxTokens: 2000 },
    });

    const synthesized = parseSynthesisResponse(response.content);

    return {
      ...analysis,
      synthesis: synthesized.synthesis,
      actionable_insights: synthesized.actionable_insights,
      sources: validated.map((v) => ({ url: v.url, title: v.title, relevance: v.relevance })),
    };
  } catch (err: any) {
    console.error("Synthesis phase LLM error:", err.message);
    return {
      ...analysis,
      synthesis: analysis.summary,
      sources: validated.map((v) => ({ url: v.url, title: v.title, relevance: v.relevance })),
    };
  }
}

function parseSynthesisResponse(tomlStr: string): {
  synthesis: string;
  actionable_insights: ActionableInsight[];
} {
  const result: { synthesis: string; actionable_insights: ActionableInsight[] } = {
    synthesis: "",
    actionable_insights: [],
  };

  const clean = tomlStr
    .replace(/^```toml?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
  let currentInsight: ActionableInsight | null = null;
  let inMultiline = false;
  let multilineKey = "";
  let multilineValue = "";

  for (const line of clean.split("\n")) {
    const trimmed = line.trim();

    // Handle multiline strings
    if (inMultiline) {
      if (trimmed === '"""') {
        (result as any)[multilineKey] = multilineValue.trim();
        inMultiline = false;
        multilineKey = "";
        multilineValue = "";
      } else {
        multilineValue += line + "\n";
      }
      continue;
    }

    if (trimmed === "[[actionable_insights]]") {
      if (currentInsight) result.actionable_insights.push(currentInsight);
      currentInsight = { insight: "", application: "" };
      continue;
    }

    const match = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      if (value === '"""') {
        inMultiline = true;
        multilineKey = key;
        multilineValue = "";
      } else if (currentInsight) {
        (currentInsight as any)[key] = value.replace(/^["']|["']$/g, "");
      } else {
        (result as any)[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  }
  if (currentInsight) result.actionable_insights.push(currentInsight);

  return result;
}

// -- Report Formatting --------------------------------------------------------

function formatSynthesisReport(result: PipelineResult, intent: string): string {
  const lines: string[] = [
    "# Research Synthesis Report",
    "",
    `> **Intent:** ${intent}`,
    "",
    `> **Generated:** ${new Date().toISOString()}`,
    "",
    "---",
    "",
    "## Summary",
    "",
    result.summary || "No summary available.",
    "",
    "## Synthesis",
    "",
    result.synthesis || result.summary || "No synthesis available.",
    "",
  ];

  // Add tags
  if (result.tags && result.tags.length > 0) {
    lines.push("## Tags", "", result.tags.map((t) => `\`${t}\``).join(" "), "");
  }

  // Add key concepts
  if (result.key_concepts && result.key_concepts.length > 0) {
    lines.push("## Key Concepts", "", result.key_concepts.map((c) => `- ${c}`).join("\n"), "");
  }

  // Add findings
  const allFindings = result.findings || result.key_findings || [];
  if (allFindings.length > 0) {
    lines.push("## Key Findings", "");
    for (const finding of allFindings) {
      lines.push(`### ${finding.topic || "Finding"}`);
      lines.push("");
      lines.push(`**Importance:** ${finding.importance || "medium"}`);
      lines.push("");
      lines.push(finding.details || finding.finding || "No details.");
      lines.push("");
      if (finding.sources && finding.sources.length > 0) {
        lines.push(`*Sources: ${finding.sources.join(", ")}*`);
        lines.push("");
      }
    }
  }

  // Add actionable insights
  if (result.actionable_insights && result.actionable_insights.length > 0) {
    lines.push("## Actionable Insights", "");
    for (const insight of result.actionable_insights) {
      lines.push(`- **${insight.insight}**`);
      if (insight.application) {
        lines.push(`  - Application: ${insight.application}`);
      }
      lines.push("");
    }
  }

  // Add sources
  if (result.sources && result.sources.length > 0) {
    lines.push("## Sources", "");
    for (const source of result.sources) {
      const relevance = source.relevance
        ? ` (relevance: ${source.relevance.toFixed(2)})`
        : "";
      lines.push(`- [${source.title || source.url}](${source.url})${relevance}`);
    }
    lines.push("");
  }

  // Add pipeline stats
  if (result.pipeline_stats) {
    const stats = result.pipeline_stats;
    lines.push("---", "", "## Pipeline Statistics", "");
    lines.push(`- URLs requested: ${stats.urls_requested}`);
    lines.push(`- URLs fetched: ${stats.urls_fetched}`);
    lines.push(`- URLs validated: ${stats.urls_validated}`);
    lines.push(`- Findings extracted: ${stats.findings_count}`);
    lines.push(`- Duration: ${stats.duration}ms`);
    lines.push("");
  }

  return lines.join("\n");
}

// -- Pipeline Runner ----------------------------------------------------------

async function runPipeline(args: {
  sessionId: string;
  urls: string[];
  intent: string;
  timeout: number;
}): Promise<PipelineResult> {
  const { sessionId, urls, intent, timeout } = args;
  const startTime = Date.now();
  const phases: {
    gather: GatherResult[] | null;
    validate: ValidatedChunk[] | null;
    analyze: AnalysisResult | null;
    synthesize: SynthesisResult | null;
  } = { gather: null, validate: null, analyze: null, synthesize: null };

  try {
    // Phase 1: GATHER
    console.log(`[Pipeline] Phase 1: Gathering ${urls.length} URLs...`);
    phases.gather = await gatherPhase(urls, sessionId, timeout);
    const successfulGathers = phases.gather.filter((g) => !g.error);
    console.log(
      `[Pipeline] Gathered ${successfulGathers.length}/${urls.length} successfully`
    );

    if (successfulGathers.length === 0) {
      return {
        success: false,
        error: "All URLs failed to fetch",
        summary: "",
        tags: [],
        key_concepts: [],
        duration: Date.now() - startTime,
      };
    }

    // Phase 2: VALIDATE
    console.log(`[Pipeline] Phase 2: Validating relevance...`);
    phases.validate = await validatePhase(phases.gather, intent);
    console.log(`[Pipeline] ${phases.validate.length} chunks passed validation`);

    if (phases.validate.length === 0) {
      return {
        success: false,
        error: "No content passed relevance validation",
        summary: "",
        tags: [],
        key_concepts: [],
        duration: Date.now() - startTime,
      };
    }

    // Phase 3: ANALYZE
    console.log(`[Pipeline] Phase 3: Analyzing content...`);
    phases.analyze = await analyzePhase(phases.validate, intent);
    console.log(
      `[Pipeline] Extracted ${phases.analyze.findings?.length || 0} findings`
    );

    // Phase 4: SYNTHESIZE
    console.log(`[Pipeline] Phase 4: Synthesizing results...`);
    phases.synthesize = await synthesizePhase(phases.analyze, phases.validate, intent);
    console.log(`[Pipeline] Synthesis complete`);

    return {
      success: true,
      ...phases.synthesize,
      pipeline_stats: {
        urls_requested: urls.length,
        urls_fetched: successfulGathers.length,
        urls_validated: phases.validate.length,
        findings_count: phases.analyze.findings?.length || 0,
        duration: Date.now() - startTime,
      },
    };
  } catch (err: any) {
    console.error("[Pipeline] Error:", err.message);
    return {
      success: false,
      error: err.message,
      summary: "",
      tags: [],
      key_concepts: [],
      duration: Date.now() - startTime,
    };
  }
}

// -- Session Storage ----------------------------------------------------------

async function saveToSessionStorage(
  sessionId: string,
  findings: PipelineResult | AnalysisResult,
  nameHint: string = ""
): Promise<string | null> {
  if (!sessionManager) return null;

  try {
    // Generate a descriptive filename from the hint
    const safeName =
      nameHint
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "research";

    const filename = `${safeName}_findings.txt`;

    // Format findings as readable text
    let content = `# Research Findings\n`;
    content += `Generated: ${new Date().toISOString()}\n\n`;

    if (findings.summary) {
      content += `## Summary\n${findings.summary}\n\n`;
    }

    if ("synthesis" in findings && findings.synthesis) {
      content += `## Synthesis\n${findings.synthesis}\n\n`;
    }

    if (findings.key_concepts?.length > 0) {
      content += `## Key Concepts\n${findings.key_concepts.map((c) => `- ${c}`).join("\n")}\n\n`;
    }

    if (findings.tags?.length > 0) {
      content += `## Tags\n${findings.tags.join(", ")}\n\n`;
    }

    const items = findings.findings || findings.key_findings || [];
    if (items.length > 0) {
      content += `## Key Findings\n`;
      for (const finding of items) {
        const topic = finding.topic || "Finding";
        const details = finding.details || finding.finding || "";
        const importance = finding.importance || "medium";
        content += `\n### ${topic} [${importance}]\n${details}\n`;
      }
      content += "\n";
    }

    if ("actionable_insights" in findings && findings.actionable_insights?.length) {
      content += `## Actionable Insights\n`;
      for (const insight of findings.actionable_insights) {
        content += `- ${insight.insight}`;
        if (insight.application) {
          content += ` (Apply: ${insight.application})`;
        }
        content += "\n";
      }
      content += "\n";
    }

    if ("sources" in findings && findings.sources?.length) {
      content += `## Sources\n`;
      for (const source of findings.sources) {
        const title = source.title || source.url;
        const relevance = source.relevance
          ? ` (${(source.relevance * 100).toFixed(0)}% relevant)`
          : "";
        content += `- ${title}${relevance}\n  ${source.url}\n`;
      }
    }

    // Save to session storage
    const session = sessionManager.getSession(sessionId);
    if (session) {
      const notes = session.notes || {};
      notes[filename] = content;
      sessionManager.store.update(sessionId, { notes });
      console.log(`[Research] Saved findings to session storage: ${filename}`);
      return filename;
    }
  } catch (err: any) {
    console.warn(`[Research] Could not save to session storage: ${err.message}`);
  }

  return null;
}

// -- Context XML --------------------------------------------------------------

function formatContextAsXml(files: ContextFile[]): string {
  const lines = ["<context>"];

  for (const file of files) {
    lines.push(`  <file path="${file.path}">`);
    lines.push(file.content);
    lines.push("  </file>");
  }

  lines.push("</context>");
  return lines.join("\n");
}

// -- Execute ------------------------------------------------------------------

async function execute(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const sandboxManager = ctx.sandbox;
  // Pull optional services from config
  llmClient = (ctx.config.llmClient as LLMClient) || null;
  sessionManager = (ctx.config.sessionManager as SessionManager) || null;
  allowedHosts = (ctx.config.allowedHosts as string[]) || ["*"];
  configTimeout = (ctx.config.timeout as number) || DEFAULT_CONFIG.timeout;
  configWaitFor = (ctx.config.waitFor as string) || DEFAULT_CONFIG.waitFor;
  configMaxContentLength =
    (ctx.config.maxContentLength as number) || DEFAULT_CONFIG.maxContentLength;
  configRemoveSelectors =
    (ctx.config.removeSelectors as string[]) || DEFAULT_CONFIG.removeSelectors;
  analysisMaxContentLength =
    (ctx.config.analysisMaxContentLength as number) || 100000;

  const sessionId = args.sessionId as string | undefined;
  const url = args.url as string | undefined;
  const urls = args.urls as string[] | undefined;
  const filename = args.filename as string | undefined;
  const title = args.title as string | undefined;
  const selector = args.selector as string | undefined;
  const waitForSelector = args.waitForSelector as string | undefined;
  const includeMetadata = (args.includeMetadata as boolean) ?? true;
  const addToContext = (args.addToContext as boolean) ?? true;
  const analyze = (args.analyze as boolean) ?? true;
  const intent = args.intent as string | undefined;
  const usePipeline = args.usePipeline as boolean | undefined;
  const requestTimeout = args.timeout as number | undefined;

  // Validate
  if (!sessionId) {
    return formatError("sessionId is required for sandbox isolation");
  }

  // Get timeout from session manager or use default
  let timeout = requestTimeout || configTimeout;
  if (sessionManager) {
    try {
      timeout = sessionManager.getToolTimeout(sessionId, "context_research_browser");
    } catch {
      // Session might not exist yet, use default
    }
  }

  // Determine if we should use pipeline mode
  const urlList = urls || (url ? [url] : []);
  const shouldUsePipeline =
    usePipeline || urlList.length > 1 || (!!intent && urlList.length === 1);

  if (urlList.length === 0) {
    return formatError("url or urls is required");
  }

  // Validate URLs
  for (const u of urlList) {
    try {
      const parsed = new URL(u);
      if (!isHostAllowed(parsed.hostname)) {
        return formatError(`Host not allowed: ${parsed.hostname}`);
      }
    } catch {
      return formatError(`Invalid URL: ${u}`);
    }
  }

  // PIPELINE MODE: Multiple URLs or explicit pipeline request
  if (shouldUsePipeline) {
    if (!intent) {
      return formatError(
        "intent is required for pipeline mode (multiple URLs or usePipeline=true)"
      );
    }

    const maxUrls = DEFAULT_CONFIG.pipeline.maxUrls;
    if (urlList.length > maxUrls) {
      return formatError(`Maximum ${maxUrls} URLs allowed per pipeline request`);
    }

    console.log(
      `[Research] Starting pipeline with ${urlList.length} URLs, intent: "${intent.slice(0, 50)}..."`
    );

    const result = await runPipeline({
      sessionId,
      urls: urlList,
      intent,
      timeout,
    });

    // Record timeout event
    if (sessionManager) {
      try {
        sessionManager.recordTimeoutEvent(
          sessionId,
          "context_research_browser",
          !result.success,
          result.pipeline_stats?.duration || result.duration || 0
        );
      } catch {
        /* ignore */
      }
    }

    // Save synthesis to context if successful
    if (result.success && addToContext) {
      try {
        const sandboxPath = await sandboxManager.ensureSandbox(sessionId);
        const artifactsDir = join(sandboxPath, "artifacts");
        if (!existsSync(artifactsDir)) {
          await mkdir(artifactsDir, { recursive: true });
        }

        const reportPath = join(artifactsDir, "research_synthesis.md");
        const reportContent = formatSynthesisReport(result, intent);
        await writeFile(reportPath, reportContent, "utf-8");

        result.report_path = "artifacts/research_synthesis.md";
      } catch (err: any) {
        console.warn("Could not save synthesis report:", err.message);
      }

      // Also save to session storage for cross-task access
      const noteFilename = await saveToSessionStorage(sessionId, result, intent);
      if (noteFilename) {
        result.session_note = noteFilename;
      }
    }

    return formatResponse(result);
  }

  // LEGACY MODE: Single URL without pipeline
  const singleUrl = urlList[0];
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(singleUrl);
  } catch {
    return formatError(`Invalid URL: ${singleUrl}`);
  }

  // Check host allowlist
  if (!isHostAllowed(parsedUrl.hostname)) {
    return formatError(`Host not allowed: ${parsedUrl.hostname}`);
  }

  // Get sandbox path
  const sandboxPath = await sandboxManager.ensureSandbox(sessionId);
  const contextDir = join(sandboxPath, "context");
  const startTime = Date.now();

  // Ensure context directory exists
  if (!existsSync(contextDir)) {
    await mkdir(contextDir, { recursive: true });
  }

  try {
    // Fetch page content
    const b = await getBrowser();
    const context = await b.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: "Mozilla/5.0 (compatible; YayAgent Research Bot/1.0)",
    });

    const page = await context.newPage();
    page.setDefaultTimeout(timeout);

    try {
      // Navigate
      await page.goto(singleUrl, {
        waitUntil:
          configWaitFor === "networkidle" ? "networkidle" : "domcontentloaded",
        timeout,
      });

      // Wait for specific selector if provided
      if (waitForSelector) {
        await page.waitForSelector(waitForSelector, { timeout: timeout / 2 });
      }

      // Remove unwanted elements
      for (const sel of configRemoveSelectors) {
        try {
          await page.evaluate(
            (selector: string) => {
              document.querySelectorAll(selector).forEach((el: Element) => el.remove());
            },
            sel
          );
        } catch {
          // Selector might not exist, continue
        }
      }

      // Get page info
      const pageTitle: string = title || (await page.title());
      const pageUrl: string = page.url();

      // Extract content
      let html: string;
      if (selector) {
        // Extract specific element
        const element = await page.$(selector);
        if (!element) {
          return formatError(`Selector not found: ${selector}`);
        }
        html = await element.innerHTML();
      } else {
        // Extract main content (try common content selectors)
        const contentSelectors = [
          "main",
          "article",
          '[role="main"]',
          ".content",
          ".main-content",
          "#content",
          "#main",
          ".post-content",
          ".article-content",
          ".entry-content",
        ];

        let foundHtml: string | null = null;
        for (const sel of contentSelectors) {
          try {
            const element = await page.$(sel);
            if (element) {
              foundHtml = await element.innerHTML();
              break;
            }
          } catch {
            continue;
          }
        }

        // Fallback to body
        if (!foundHtml) {
          foundHtml = await page.evaluate(() => document.body.innerHTML);
        }
        html = foundHtml as string;
      }

      // Convert to markdown
      let markdown = htmlToMarkdown(html);

      // Truncate if too long
      if (markdown.length > configMaxContentLength) {
        markdown =
          markdown.slice(0, configMaxContentLength) + "\n\n... (content truncated)";
      }

      // Add metadata header
      if (includeMetadata) {
        const metadataHeader = [
          "---",
          `title: "${pageTitle.replace(/"/g, '\\"')}"`,
          `url: "${pageUrl}"`,
          `fetched_at: "${new Date().toISOString()}"`,
          `source: context_research_browser`,
          "---",
          "",
          `# ${pageTitle}`,
          "",
          `> Source: [${pageUrl}](${pageUrl})`,
          "",
          "",
        ].join("\n");

        markdown = metadataHeader + markdown;
      }

      // Generate filename
      const outputFilename = filename || urlToFilename(singleUrl);
      const outputPath = join(contextDir, outputFilename);

      // Write to file
      await writeFile(outputPath, markdown, "utf-8");

      // Generate content hash
      const contentHash = createHash("sha256")
        .update(markdown)
        .digest("hex")
        .slice(0, 16);

      // Build context file entry
      const contextFile: ContextFile = {
        path: `context/${outputFilename}`,
        content: markdown,
        type: "text/markdown",
        size: markdown.length,
        contentHash,
        metadata: {
          sourceUrl: pageUrl,
          pageTitle,
          fetchedAt: new Date().toISOString(),
          tool: "context_research_browser",
        },
      };

      // Add to session context if session manager available
      let contextUpdated = false;
      if (addToContext && sessionManager) {
        try {
          const session = sessionManager.getSession(sessionId);
          if (session && session.context) {
            // Add file to context
            const updatedFiles = [...session.context.files, contextFile];

            // Update formatted content
            const formattedContent = formatContextAsXml(updatedFiles);

            // Update session
            sessionManager.store.update(sessionId, {
              context: {
                ...session.context,
                files: updatedFiles,
                formattedContent,
                metadata: {
                  ...session.context.metadata,
                  totalFiles: updatedFiles.length,
                  totalSize: updatedFiles.reduce(
                    (sum: number, f: ContextFile) => sum + f.size,
                    0
                  ),
                },
              },
            });

            contextUpdated = true;
          }
        } catch (err: any) {
          // Session might not exist yet, that's OK
          console.warn("Could not update session context:", err.message);
        }
      }

      // Analyze content if enabled
      let analysis: AnalysisResult | null = null;
      let sessionNote: string | null = null;
      if (analyze) {
        analysis = await analyzeContent(
          markdown,
          { title: pageTitle, url: pageUrl },
          intent ?? null
        );

        // Save analysis to session storage for cross-task access
        if (analysis && addToContext) {
          const nameHint = intent || pageTitle || parsedUrl.hostname;
          sessionNote = await saveToSessionStorage(sessionId, analysis, nameHint);
        }
      }

      // Record successful completion for timeout learning
      const duration = Date.now() - startTime;
      if (sessionManager) {
        try {
          sessionManager.recordTimeoutEvent(
            sessionId,
            "context_research_browser",
            false,
            duration
          );
        } catch {
          // Ignore if session doesn't exist
        }
      }

      return formatResponse({
        success: true,
        url: pageUrl,
        title: pageTitle,
        outputPath: `context/${outputFilename}`,
        absolutePath: outputPath,
        contentLength: markdown.length,
        contentHash,
        contextUpdated,
        sandboxPath,
        message: `Research content saved to context/${outputFilename}`,
        analysis,
        session_note: sessionNote,
        duration,
      });
    } finally {
      await context.close();
    }
  } catch (err: any) {
    // Record timeout/failure for adaptive learning
    const duration = Date.now() - startTime;
    const timedOut =
      err.message.includes("timeout") || err.message.includes("Timeout");
    if (sessionManager) {
      try {
        sessionManager.recordTimeoutEvent(
          sessionId,
          "context_research_browser",
          timedOut,
          duration
        );
      } catch {
        // Ignore if session doesn't exist
      }
    }
    return formatError(`Failed to fetch content: ${err.message}`);
  }
}

// -- Tool Definition ----------------------------------------------------------

const contextResearchBrowserTool: Tool = {
  name: "context_research_browser",
  description: `Fetch web page content, convert to markdown, analyze key findings, and add to session context.

MODES:
1. SINGLE URL MODE: Provide 'url' for simple one-page research
2. PIPELINE MODE: Provide 'urls' array for multi-source research with phased processing

PIPELINE MODE (Recommended for research tasks):
When using 'urls' (array) or setting 'usePipeline: true', the tool runs a 4-phase pipeline:
- Phase 1 (GATHER): Parallel fetch of all URLs, extract content to markdown
- Phase 2 (VALIDATE): LLM scores each source's relevance to intent, filters low-scoring
- Phase 3 (ANALYZE): LLM extracts structured findings from validated content
- Phase 4 (SYNTHESIZE): LLM combines findings into cohesive report with actionable insights

Pipeline mode REQUIRES the 'intent' parameter to guide relevance scoring and analysis.
Saves a synthesis report to artifacts/research_synthesis.md.

USE CASES:
- Research documentation for a task
- Gather reference material from multiple websites
- Add external resources to session context
- Extract and analyze specific content from web pages

SINGLE URL WORKFLOW:
1. Fetches URL with headless browser (handles JavaScript-rendered content)
2. Extracts main content (or specific selector)
3. Converts HTML to clean Markdown
4. Analyzes content to extract key findings (guided by intent if provided)
5. Saves to context directory in sandbox

ANALYSIS OUTPUT:
- summary: 2-3 sentence summary directly addressing research intent
- tags: Topic categorization (5-10 tags)
- key_concepts: Main terminology and technical terms (5-10 items)
- key_findings: Array of {topic, finding, importance} with specific details

PIPELINE OUTPUT (additional):
- synthesis: Cohesive narrative combining all findings
- actionable_insights: Specific insights with applications
- sources: List of validated sources with relevance scores
- pipeline_stats: URLs requested/fetched/validated, findings count, duration

INTENT-DRIVEN ANALYSIS:
The 'intent' parameter guides what information to extract and prioritize.
Example intent: "identify video game music styles, chord progressions, and compositional techniques"

FEATURES:
- Handles JavaScript-rendered pages
- Removes navigation, ads, popups automatically
- Parallel fetching for multiple URLs (pipeline mode)
- Relevance-based filtering (pipeline mode)
- Automatic LLM-powered content analysis
- Intent-driven extraction for task-specific results`,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID for sandbox isolation (required)",
      },
      url: {
        type: "string",
        description: "Single URL to fetch (use for simple one-page research)",
      },
      urls: {
        type: "array",
        items: { type: "string" },
        maxItems: 5,
        description:
          "Array of URLs to fetch and process through pipeline (max 5). Requires intent parameter.",
      },
      usePipeline: {
        type: "boolean",
        default: false,
        description:
          "Force pipeline mode even for single URL. Enables phased processing with relevance validation.",
      },
      intent: {
        type: "string",
        description:
          'Research intent/objective. REQUIRED for pipeline mode. Guides relevance scoring and analysis focus. Example: "identify video game music styles, chord progressions, and compositional techniques"',
      },
      filename: {
        type: "string",
        description:
          "Output filename for single URL mode (optional, auto-generated from URL)",
      },
      title: {
        type: "string",
        description: "Override page title in metadata (single URL mode)",
      },
      selector: {
        type: "string",
        description:
          "CSS selector to extract specific content (single URL mode)",
      },
      waitForSelector: {
        type: "string",
        description:
          "CSS selector to wait for before extracting (for dynamic content, single URL mode)",
      },
      includeMetadata: {
        type: "boolean",
        default: true,
        description:
          "Include YAML frontmatter with source URL and metadata (single URL mode)",
      },
      addToContext: {
        type: "boolean",
        default: true,
        description:
          "Add to session context (single URL) or save synthesis report (pipeline)",
      },
      analyze: {
        type: "boolean",
        default: true,
        description:
          "Analyze content and include findings in response (single URL mode)",
      },
      timeout: {
        type: "integer",
        default: 60000,
        description: "Page load timeout in milliseconds per URL",
      },
    },
    required: ["sessionId"],
  },
  needsSandbox: true,
  execute,
};

export default contextResearchBrowserTool;
