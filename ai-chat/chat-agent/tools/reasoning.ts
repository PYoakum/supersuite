import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ──────────────────────────────────────────────────

const REQUEST_TIMEOUT = 120_000;

const PROVIDER_KEY_MAP: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  "openai-compat": "OPENAI_API_KEY",
};

const PROVIDER_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  gemini: "https://generativelanguage.googleapis.com",
};

// ── LLM Call Helpers ───────────────────────────────────────────

interface LLMCallConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  maxTokens: number;
  temperature: number;
}

function resolveConfig(
  mode: "thinking" | "analyzing" | "reviewing_work",
  ctx: ToolContext,
  argsProvider?: string,
  argsModel?: string,
): LLMCallConfig {
  const llm = (ctx.config.llm as any) || {};
  const reasoning = (ctx.config.reasoning as any) || {};
  const override = reasoning[mode] || {};

  // Priority: tool args > reasoning override > agent default
  const provider = argsProvider || override.provider || llm.provider || "anthropic";
  const model = argsModel || override.model || llm.model || "claude-sonnet-4-20250514";
  const keyEnv = override.api_key_env || llm.api_key_env || PROVIDER_KEY_MAP[provider] || "LLM_API_KEY";
  const apiKey = process.env[keyEnv] || "";
  const baseUrl = override.base_url || llm.base_url || PROVIDER_URLS[provider] || "";
  const maxTokens = override.max_tokens || 4096;
  const temperature = override.temperature ?? 0.2;

  return { provider, model, apiKey, baseUrl, maxTokens, temperature };
}

async function callLLM(config: LLMCallConfig, systemPrompt: string, userPrompt: string): Promise<string> {
  const { provider, model, apiKey, baseUrl, maxTokens, temperature } = config;

  if (!apiKey) throw new Error(`No API key found for ${provider}. Check env var.`);

  if (provider === "anthropic") {
    const res = await fetch(`${baseUrl || "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`); }
    const data = await res.json() as any;
    const text = data.content?.map((b: any) => b.text).join("") || "";
    return text;
  }

  if (provider === "openai" || provider === "openai-compat") {
    const url = baseUrl || "https://api.openai.com";
    const res = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        max_completion_tokens: maxTokens,
        temperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (!res.ok) { const t = await res.text(); throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`); }
    const data = await res.json() as any;
    return data.choices?.[0]?.message?.content || "";
  }

  if (provider === "gemini") {
    const res = await fetch(
      `${baseUrl || "https://generativelanguage.googleapis.com"}/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      },
    );
    if (!res.ok) { const t = await res.text(); throw new Error(`Gemini ${res.status}: ${t.slice(0, 300)}`); }
    const data = await res.json() as any;
    return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
  }

  throw new Error(`Unknown provider: ${provider}`);
}

// ── System Prompts ─────────────────────────────────────────────

const THINKING_SYSTEM = `You are a strategic reasoning assistant. Before taking action, you carefully evaluate the situation.

Your job: Given a prompt, task description, or plan, think through it step-by-step.
- Identify potential issues, ambiguities, or gaps
- Consider edge cases and failure modes
- Evaluate whether the approach is clear and actionable
- Suggest improvements or clarifications if needed
- Rate confidence (1-10) in the plan's likely success

Be concise but thorough. Focus on what matters most.`;

const ANALYZING_SYSTEM = `You are a context analysis assistant. You evaluate available information to ensure completeness.

Your job: Given context (conversation history, task state, available resources), analyze it.
- Identify what information is present and what's missing
- Flag contradictions or inconsistencies
- Assess whether the context is sufficient for the task at hand
- Highlight the most relevant pieces of information
- Note any assumptions being made

Be structured and factual. Don't speculate — flag unknowns explicitly.`;

const REVIEWING_SYSTEM = `You are a quality review assistant. You evaluate completed work against requirements.

Your job: Given completed work output and the original requirements, review it.
- Check if all requirements are met
- Identify errors, omissions, or quality issues
- Evaluate completeness (percentage of requirements addressed)
- Check for consistency and correctness
- Provide specific, actionable feedback

Rate overall quality (1-10) and list specific issues. Be direct and constructive.`;

// ── Tool Execute Functions ─────────────────────────────────────

async function executeThinking(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const prompt = args.prompt as string | undefined;
  const task = args.task as string | undefined;
  const plan = args.plan as string | undefined;

  if (!prompt && !task && !plan) return formatError("At least one of prompt, task, or plan is required");

  const userContent = [
    prompt ? `## Prompt to evaluate\n${prompt}` : "",
    task ? `## Task description\n${task}` : "",
    plan ? `## Plan\n${plan}` : "",
  ].filter(Boolean).join("\n\n");

  const config = resolveConfig("thinking", ctx, args.provider as string, args.model as string);

  try {
    const result = await callLLM(config, THINKING_SYSTEM, userContent);
    return formatResponse({
      mode: "thinking",
      model: `${config.provider}/${config.model}`,
      analysis: result,
    });
  } catch (err: any) {
    return formatError(`Thinking failed: ${err.message}`);
  }
}

async function executeAnalyzing(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const context_text = args.context as string | undefined;
  const task = args.task as string | undefined;
  const question = args.question as string | undefined;

  if (!context_text && !task) return formatError("At least context or task is required");

  const userContent = [
    context_text ? `## Available context\n${context_text}` : "",
    task ? `## Task at hand\n${task}` : "",
    question ? `## Specific question\n${question}` : "",
  ].filter(Boolean).join("\n\n");

  const config = resolveConfig("analyzing", ctx, args.provider as string, args.model as string);

  try {
    const result = await callLLM(config, ANALYZING_SYSTEM, userContent);
    return formatResponse({
      mode: "analyzing",
      model: `${config.provider}/${config.model}`,
      analysis: result,
    });
  } catch (err: any) {
    return formatError(`Analysis failed: ${err.message}`);
  }
}

async function executeReviewingWork(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const work = args.work as string | undefined;
  const requirements = args.requirements as string | undefined;
  const criteria = args.criteria as string | undefined;

  if (!work) return formatError("work is required (the output to review)");

  const userContent = [
    `## Work output\n${work}`,
    requirements ? `## Original requirements\n${requirements}` : "",
    criteria ? `## Evaluation criteria\n${criteria}` : "",
  ].filter(Boolean).join("\n\n");

  const config = resolveConfig("reviewing_work", ctx, args.provider as string, args.model as string);

  try {
    const result = await callLLM(config, REVIEWING_SYSTEM, userContent);
    return formatResponse({
      mode: "reviewing_work",
      model: `${config.provider}/${config.model}`,
      review: result,
    });
  } catch (err: any) {
    return formatError(`Review failed: ${err.message}`);
  }
}

// ── Tool Definitions ───────────────────────────────────────────

const thinkingTool: Tool = {
  name: "thinking",
  description:
    "Strategic reasoning before action. Evaluates prompts, tasks, or plans step-by-step. " +
    "Identifies issues, ambiguities, edge cases, and suggests improvements. " +
    "Use before starting complex work to validate your approach. " +
    "Supports model override via provider/model args or [reasoning.thinking] config.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "A prompt to evaluate before sending" },
      task: { type: "string", description: "A task description to think through" },
      plan: { type: "string", description: "A plan or approach to evaluate" },
      provider: { type: "string", description: "Override LLM provider (anthropic, openai, gemini)" },
      model: { type: "string", description: "Override model name" },
    },
  },
  execute: executeThinking,
};

const analyzingTool: Tool = {
  name: "analyzing",
  description:
    "Context analysis for completeness and consistency. Reviews available information, " +
    "flags missing data, contradictions, and assumptions. Use to assess whether you have " +
    "enough context before proceeding with a task. " +
    "Supports model override via provider/model args or [reasoning.analyzing] config.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      context: { type: "string", description: "Available context to analyze (conversation, data, etc.)" },
      task: { type: "string", description: "The task this context is for" },
      question: { type: "string", description: "Specific question about the context" },
      provider: { type: "string", description: "Override LLM provider" },
      model: { type: "string", description: "Override model name" },
    },
  },
  execute: executeAnalyzing,
};

const reviewingWorkTool: Tool = {
  name: "reviewing_work",
  description:
    "Quality review of completed work against requirements. Checks completeness, correctness, " +
    "and consistency. Rates quality 1-10 with specific actionable feedback. " +
    "Use after completing work to validate before delivering. " +
    "Supports model override via provider/model args or [reasoning.reviewing_work] config.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      work: { type: "string", description: "The completed work output to review" },
      requirements: { type: "string", description: "Original requirements or task description" },
      criteria: { type: "string", description: "Specific evaluation criteria" },
      provider: { type: "string", description: "Override LLM provider" },
      model: { type: "string", description: "Override model name" },
    },
    required: ["work"],
  },
  execute: executeReviewingWork,
};

const tools: Tool[] = [thinkingTool, analyzingTool, reviewingWorkTool];

export default tools;
