import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse } from "./types";

// ── Types ───────────────────────────────────────────────────

interface Recipient {
  name: string;
  relationship?: string;
  context?: string;
}

interface PromptConstraints {
  maxLength?: number;
  minLength?: number;
  formality?: "override" | "inherit";
  formalityLevel?: number;
}

interface ComposePrompt {
  subject: string;
  recipient: Recipient;
  purpose: string;
  keyPoints?: string[];
  additionalInstructions?: string;
  constraints?: PromptConstraints;
}

interface OutputConfig {
  format?: string;
  path?: string;
  filename?: string;
  includeMetadata?: boolean;
  template?: string;
}

interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
}

interface LLMResponse {
  content: string;
  usage?: { totalTokens?: number };
}

interface LLMClient {
  model?: string;
  send: (params: Record<string, unknown>) => Promise<LLMResponse>;
}

interface PersonaDef {
  name: string;
  displayName: string;
  description?: string;
  tone: {
    primary: string;
    secondary?: string[];
    formality?: number;
    warmth?: number;
    assertiveness?: number;
  };
  personality: {
    traits: string[];
    voice: string;
    perspective?: string;
  };
  language?: {
    primary?: string;
    vocabulary?: {
      level?: string;
      jargonAllowed?: boolean;
      jargonDomains?: string[];
    };
    sentenceStructure?: { complexity?: string };
  };
  motivations?: string[];
  wordChoice?: {
    preferred?: { word: string; instead_of: string }[];
    avoided?: string[];
    signature_phrases?: string[];
    contractions?: string;
  };
  emotion?: {
    baseline?: string;
    range?: string[];
    intensity?: number;
    expressiveness?: number;
  };
  contextModifiers?: Record<string, { tone?: Record<string, number>; emotion?: { baseline?: string } }>;
}

interface PersonasFile {
  version?: string;
  personas: PersonaDef[];
}

interface CacheEntry {
  data: PersonasFile;
  timestamp: number;
}

// ── Constants ───────────────────────────────────────────────

const ErrorCodes = {
  PERSONA_NOT_FOUND: "PERSONA_NOT_FOUND",
  PERSONAS_FILE_NOT_FOUND: "PERSONAS_FILE_NOT_FOUND",
  PERSONAS_INVALID_YAML: "PERSONAS_INVALID_YAML",
  PERSONAS_SCHEMA_ERROR: "PERSONAS_SCHEMA_ERROR",
  PROMPT_INCOMPLETE: "PROMPT_INCOMPLETE",
  OUTPUT_PATH_INVALID: "OUTPUT_PATH_INVALID",
  LLM_GENERATION_FAILED: "LLM_GENERATION_FAILED",
  LLM_TIMEOUT: "LLM_TIMEOUT",
  CONTENT_TOO_LONG: "CONTENT_TOO_LONG",
  CONTENT_TOO_SHORT: "CONTENT_TOO_SHORT",
  PATH_TRAVERSAL: "PATH_TRAVERSAL",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
} as const;

const DEFAULT_PERSONAS_FILE = "PERSONAS.yml";
const MAX_PERSONAS_FILE_SIZE = 1048576; // 1MB
const MAX_OUTPUT_SIZE = 102400; // 100KB
const DEFAULT_OUTPUT_FORMAT = "text";
const DEFAULT_TEMPLATE = "letter";
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 1024;
const CACHE_TTL = 3600000; // 1 hour

// ── Output Templates ────────────────────────────────────────

const OutputTemplates: Record<string, { format: (content: string, metadata: { subject: string; recipient: Recipient }) => string }> = {
  letter: {
    format: (content) => {
      const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      return `${date}\n\n${content}\n`;
    },
  },
  email: {
    format: (content, metadata) => {
      return `Subject: ${metadata.subject}\nTo: ${metadata.recipient.name}\n\n${content}`;
    },
  },
  memo: {
    format: (content, metadata) => {
      const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      return `MEMORANDUM\n\nTO: ${metadata.recipient.name}\nDATE: ${date}\nRE: ${metadata.subject}\n\n${content}`;
    },
  },
  note: { format: (content) => content },
  raw: { format: (content) => content },
};

// ── Module State ────────────────────────────────────────────

const personaCache = new Map<string, CacheEntry>();

// ── Helpers ─────────────────────────────────────────────────

function fmtError(code: string, message: string, details: Record<string, unknown> = {}): ToolResult {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({ success: false, error: { code, message, details } }, null, 2),
    }],
  };
}

function findPersona(personas: PersonasFile, name: string): PersonaDef | null {
  if (!personas.personas || !Array.isArray(personas.personas)) return null;
  return personas.personas.find((p) => p.name === name) || null;
}

function validatePersonasSchema(personas: PersonasFile): string[] {
  const errors: string[] = [];

  if (!personas.version) errors.push("Missing required field: version");
  if (!personas.personas || !Array.isArray(personas.personas)) {
    errors.push("Missing or invalid field: personas (must be an array)");
    return errors;
  }
  if (personas.personas.length === 0) {
    errors.push("personas array must have at least one persona");
  }

  personas.personas.forEach((p, idx) => {
    const prefix = `personas[${idx}]`;
    if (!p.name) errors.push(`${prefix}: missing required field 'name'`);
    if (!p.displayName) errors.push(`${prefix}: missing required field 'displayName'`);
    if (!p.tone) errors.push(`${prefix}: missing required field 'tone'`);
    if (!p.tone?.primary) errors.push(`${prefix}.tone: missing required field 'primary'`);
    if (!p.personality) errors.push(`${prefix}: missing required field 'personality'`);
    if (!p.personality?.traits) errors.push(`${prefix}.personality: missing required field 'traits'`);
    if (!p.personality?.voice) errors.push(`${prefix}.personality: missing required field 'voice'`);

    if (p.name && !/^[a-z][a-z0-9-_]*$/.test(p.name)) {
      errors.push(`${prefix}.name: must be kebab-case (pattern: ^[a-z][a-z0-9-_]*$)`);
    }
  });

  return errors;
}

async function loadPersonasFile(
  ctx: ToolContext,
  sessionId: string | undefined,
  personasFile: string,
  skipCache = false,
): Promise<PersonasFile> {
  const cacheKey = `${sessionId}:${personasFile}`;

  if (!skipCache && personaCache.has(cacheKey)) {
    const cached = personaCache.get(cacheKey)!;
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
    personaCache.delete(cacheKey);
  }

  let absPath: string;
  try {
    absPath = await ctx.sandbox.resolvePath(sessionId, personasFile);
  } catch {
    const error = new Error(`Cannot resolve path: ${personasFile}`) as Error & { code?: string };
    error.code = ErrorCodes.PATH_TRAVERSAL;
    throw error;
  }

  if (!existsSync(absPath)) {
    const error = new Error(`Personas file not found: ${personasFile}`) as Error & { code?: string };
    error.code = ErrorCodes.PERSONAS_FILE_NOT_FOUND;
    throw error;
  }

  const content = await readFile(absPath, "utf-8");

  if (content.length > MAX_PERSONAS_FILE_SIZE) {
    const error = new Error(`Personas file exceeds maximum size of ${MAX_PERSONAS_FILE_SIZE} bytes`) as Error & { code?: string };
    error.code = ErrorCodes.PERSONAS_SCHEMA_ERROR;
    throw error;
  }

  let parsed: PersonasFile;
  try {
    parsed = parseYaml(content) as PersonasFile;
  } catch (err: any) {
    const error = new Error(`Invalid YAML: ${err.message}`) as Error & { code?: string };
    error.code = ErrorCodes.PERSONAS_INVALID_YAML;
    throw error;
  }

  personaCache.set(cacheKey, { data: parsed, timestamp: Date.now() });

  return parsed;
}

function buildSystemPrompt(persona: PersonaDef, prompt: ComposePrompt): string {
  const parts: string[] = [];

  parts.push(`You are writing as ${persona.displayName}: ${persona.description || ""}`);
  parts.push("");

  // Tone
  parts.push("TONE:");
  parts.push(`- Primary tone: ${persona.tone.primary}`);
  if (persona.tone.secondary?.length) {
    parts.push(`- Additional qualities: ${persona.tone.secondary.join(", ")}`);
  }
  if (persona.tone.formality) parts.push(`- Formality level: ${persona.tone.formality}/10`);
  if (persona.tone.warmth) parts.push(`- Warmth level: ${persona.tone.warmth}/10`);
  if (persona.tone.assertiveness) parts.push(`- Assertiveness: ${persona.tone.assertiveness}/10`);
  parts.push("");

  // Personality
  parts.push("PERSONALITY:");
  parts.push(`- Core traits: ${persona.personality.traits.join(", ")}`);
  parts.push(`- Voice: ${persona.personality.voice}`);
  if (persona.personality.perspective) parts.push(`- Perspective: ${persona.personality.perspective}`);
  parts.push("");

  // Language
  if (persona.language) {
    parts.push("LANGUAGE GUIDELINES:");
    if (persona.language.primary) parts.push(`- Language: ${persona.language.primary}`);
    if (persona.language.vocabulary) {
      parts.push(`- Vocabulary level: ${persona.language.vocabulary.level || "standard"}`);
      if (persona.language.vocabulary.jargonAllowed) {
        const domains = persona.language.vocabulary.jargonDomains?.join(", ") || "general";
        parts.push(`- Technical jargon: permitted in ${domains}`);
      } else {
        parts.push("- Technical jargon: avoid");
      }
    }
    if (persona.language.sentenceStructure) {
      parts.push(`- Sentence complexity: ${persona.language.sentenceStructure.complexity || "moderate"}`);
    }
    parts.push("");
  }

  // Motivations
  if (persona.motivations?.length) {
    parts.push("MOTIVATIONS:");
    persona.motivations.forEach((m) => parts.push(`- ${m}`));
    parts.push("");
  }

  // Word choice
  if (persona.wordChoice) {
    parts.push("WORD CHOICE:");
    if (persona.wordChoice.preferred?.length) {
      parts.push("Preferred substitutions:");
      persona.wordChoice.preferred.forEach((p) => {
        parts.push(`- Use "${p.word}" instead of "${p.instead_of}"`);
      });
    }
    if (persona.wordChoice.avoided?.length) {
      parts.push(`Words to avoid: ${persona.wordChoice.avoided.join(", ")}`);
    }
    if (persona.wordChoice.signature_phrases?.length) {
      parts.push("Signature phrases you may use naturally:");
      persona.wordChoice.signature_phrases.forEach((p) => parts.push(`- "${p}"`));
    }
    if (persona.wordChoice.contractions) {
      parts.push(`Contractions: ${persona.wordChoice.contractions}`);
    }
    parts.push("");
  }

  // Emotion
  if (persona.emotion) {
    parts.push("EMOTIONAL EXPRESSION:");
    if (persona.emotion.baseline) parts.push(`- Baseline state: ${persona.emotion.baseline}`);
    if (persona.emotion.range?.length) parts.push(`- Emotional range: ${persona.emotion.range.join(", ")}`);
    if (persona.emotion.intensity) parts.push(`- Intensity: ${persona.emotion.intensity}/10`);
    if (persona.emotion.expressiveness) parts.push(`- Expressiveness: ${persona.emotion.expressiveness}/10`);
    parts.push("");
  }

  // Apply context modifiers based on purpose
  if (persona.contextModifiers && prompt.purpose) {
    const purposeModifiers: Record<string, string> = {
      apologize: "sensitiveTopics",
      complain: "urgentMatter",
      congratulate: "celebratory",
      thank: "celebratory",
    };
    const modifierKey = purposeModifiers[prompt.purpose];
    if (modifierKey && persona.contextModifiers[modifierKey]) {
      const mod = persona.contextModifiers[modifierKey];
      parts.push(`CONTEXT ADJUSTMENT (${modifierKey}):`);
      if (mod.tone) {
        Object.entries(mod.tone).forEach(([k, v]) => {
          parts.push(`- Adjusted ${k}: ${v}/10`);
        });
      }
      if (mod.emotion?.baseline) {
        parts.push(`- Emotional baseline: ${mod.emotion.baseline}`);
      }
      parts.push("");
    }
  }

  parts.push("INSTRUCTIONS:");
  parts.push("- Write naturally in this persona's voice");
  parts.push("- Do not include meta-commentary or notes");
  parts.push("- Do not include subject lines or headers unless specifically requested");
  parts.push("- Focus on the content itself");

  return parts.join("\n");
}

function buildUserPrompt(prompt: ComposePrompt): string {
  const parts: string[] = [];

  parts.push(`Write a ${prompt.purpose} letter/message about: ${prompt.subject}`);
  parts.push("");
  parts.push(`Recipient: ${prompt.recipient.name}`);
  if (prompt.recipient.relationship) parts.push(`Relationship: ${prompt.recipient.relationship}`);
  if (prompt.recipient.context) parts.push(`Context about recipient: ${prompt.recipient.context}`);
  parts.push("");

  if (prompt.keyPoints?.length) {
    parts.push("Key points to include:");
    prompt.keyPoints.forEach((p) => parts.push(`- ${p}`));
    parts.push("");
  }

  if (prompt.additionalInstructions) {
    parts.push(`Additional instructions: ${prompt.additionalInstructions}`);
    parts.push("");
  }

  if (prompt.constraints) {
    if (prompt.constraints.maxLength) {
      parts.push(`Maximum length: approximately ${prompt.constraints.maxLength} characters`);
    }
    if (prompt.constraints.formality === "override" && prompt.constraints.formalityLevel) {
      parts.push(`Formality override: ${prompt.constraints.formalityLevel}/10`);
    }
  }

  return parts.join("\n");
}

async function callLLM(
  llmClient: LLMClient | undefined,
  systemPrompt: string,
  userPrompt: string,
  options: LLMOptions,
  sessionId: string | undefined,
): Promise<LLMResponse> {
  if (!llmClient) {
    return {
      content: `[Mock response for testing]\n\nDear ${userPrompt.includes("Recipient:") ? "Recipient" : "Reader"},\n\nThis is a placeholder response generated without an LLM client.\n\nBest regards`,
      usage: { totalTokens: 50 },
    };
  }

  const parameters = {
    temperature: options.temperature || DEFAULT_TEMPERATURE,
    maxTokens: options.maxTokens || DEFAULT_MAX_TOKENS,
  };

  return await llmClient.send({
    systemPrompt,
    userPrompt,
    parameters,
    sessionId,
    operation: "persona_compose",
  });
}

// ── Operations ──────────────────────────────────────────────

async function compose(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const personaName = args.personaName as string | undefined;
  const personasFile = (args.personasFile as string) ?? DEFAULT_PERSONAS_FILE;
  const prompt = args.prompt as ComposePrompt | undefined;
  const output = (args.output as OutputConfig) ?? {};
  const llmOptions = (args.llmOptions as LLMOptions) ?? {};

  if (!personaName) return fmtError(ErrorCodes.PROMPT_INCOMPLETE, "personaName is required");
  if (!prompt || !prompt.subject || !prompt.recipient?.name || !prompt.purpose) {
    return fmtError(ErrorCodes.PROMPT_INCOMPLETE, "prompt must include subject, recipient.name, and purpose");
  }

  const llmClient = ctx.config.llmClient as LLMClient | undefined;

  try {
    const personas = await loadPersonasFile(ctx, sessionId, personasFile);
    const persona = findPersona(personas, personaName);
    if (!persona) {
      return fmtError(ErrorCodes.PERSONA_NOT_FOUND, `Persona '${personaName}' not found`, {
        requestedPersona: personaName,
        availablePersonas: personas.personas.map((p) => p.name),
        personasFile,
      });
    }

    const systemPrompt = buildSystemPrompt(persona, prompt);
    const userPrompt = buildUserPrompt(prompt);

    const startTime = Date.now();
    const llmResponse = await callLLM(llmClient, systemPrompt, userPrompt, llmOptions, sessionId);
    const duration = Date.now() - startTime;

    let content = llmResponse.content;

    const constraints = prompt.constraints || {};
    const minLength = constraints.minLength || 100;
    const maxLength = constraints.maxLength || 1000;

    if (content.length < minLength) {
      return fmtError(ErrorCodes.CONTENT_TOO_SHORT, `Generated content (${content.length} chars) is below minimum (${minLength})`);
    }
    if (content.length > maxLength) {
      content = content.slice(0, maxLength);
    }

    const template = output.template || DEFAULT_TEMPLATE;
    const formatter = OutputTemplates[template] || OutputTemplates.raw;
    const formattedContent = formatter.format(content, { subject: prompt.subject, recipient: prompt.recipient });

    const format = output.format || DEFAULT_OUTPUT_FORMAT;
    const extension = format === "markdown" ? ".md" : ".txt";
    const filename = output.filename || `letter-${Date.now()}${extension}`;
    const outputPath = output.path || `output/${filename}`;

    const buffer = Buffer.from(formattedContent, "utf-8");

    if (buffer.length > MAX_OUTPUT_SIZE) {
      return fmtError(ErrorCodes.QUOTA_EXCEEDED, `Output size (${buffer.length}) exceeds maximum (${MAX_OUTPUT_SIZE})`);
    }

    const absPath = await ctx.sandbox.resolvePath(sessionId, outputPath);
    await ctx.sandbox.ensureParentDir(absPath);
    await writeFile(absPath, buffer);
    ctx.sandbox.updateSandboxSize(sessionId, buffer.length);

    return formatResponse({
      success: true,
      operation: "compose",
      result: {
        content: formattedContent,
        wordCount: formattedContent.split(/\s+/).length,
        characterCount: formattedContent.length,
        persona: personaName,
        outputFile: { path: outputPath, format, size: buffer.length },
      },
      generation: {
        model: llmClient?.model || "unknown",
        tokensUsed: llmResponse.usage?.totalTokens,
        temperature: llmOptions.temperature || DEFAULT_TEMPERATURE,
        duration,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        personaVersion: personas.version || "1.0",
        promptHash: `sha256:${createHash("sha256").update(userPrompt).digest("hex").slice(0, 8)}`,
      },
    });
  } catch (err: any) {
    if (err.code && Object.values(ErrorCodes).includes(err.code)) {
      return fmtError(err.code, err.message, err.details);
    }
    return fmtError(ErrorCodes.LLM_GENERATION_FAILED, err.message);
  }
}

async function preview(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const personaName = args.personaName as string | undefined;
  const personasFile = (args.personasFile as string) ?? DEFAULT_PERSONAS_FILE;
  const prompt = args.prompt as ComposePrompt | undefined;
  const llmOptions = (args.llmOptions as LLMOptions) ?? {};

  if (!personaName) return fmtError(ErrorCodes.PROMPT_INCOMPLETE, "personaName is required");
  if (!prompt || !prompt.subject || !prompt.recipient?.name || !prompt.purpose) {
    return fmtError(ErrorCodes.PROMPT_INCOMPLETE, "prompt must include subject, recipient.name, and purpose");
  }

  const llmClient = ctx.config.llmClient as LLMClient | undefined;

  try {
    const personas = await loadPersonasFile(ctx, sessionId, personasFile);
    const persona = findPersona(personas, personaName);
    if (!persona) {
      return fmtError(ErrorCodes.PERSONA_NOT_FOUND, `Persona '${personaName}' not found`, {
        requestedPersona: personaName,
        availablePersonas: personas.personas.map((p) => p.name),
      });
    }

    const systemPrompt = buildSystemPrompt(persona, prompt);
    const userPrompt = buildUserPrompt(prompt);

    const startTime = Date.now();
    const llmResponse = await callLLM(llmClient, systemPrompt, userPrompt, llmOptions, sessionId);
    const duration = Date.now() - startTime;

    return formatResponse({
      success: true,
      operation: "preview",
      result: {
        content: llmResponse.content,
        wordCount: llmResponse.content.split(/\s+/).length,
        characterCount: llmResponse.content.length,
        persona: personaName,
      },
      generation: {
        model: llmClient?.model || "unknown",
        tokensUsed: llmResponse.usage?.totalTokens,
        duration,
      },
    });
  } catch (err: any) {
    return fmtError(ErrorCodes.LLM_GENERATION_FAILED, err.message);
  }
}

async function listPersonas(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const personasFile = (args.personasFile as string) ?? DEFAULT_PERSONAS_FILE;

  try {
    const personas = await loadPersonasFile(ctx, sessionId, personasFile);

    return formatResponse({
      success: true,
      operation: "list_personas",
      personas: personas.personas.map((p) => ({
        name: p.name,
        displayName: p.displayName,
        description: p.description || "",
      })),
      count: personas.personas.length,
      source: personasFile,
    });
  } catch (err: any) {
    if (err.code === ErrorCodes.PERSONAS_FILE_NOT_FOUND) {
      return fmtError(err.code, err.message);
    }
    return fmtError(ErrorCodes.PERSONAS_INVALID_YAML, err.message);
  }
}

async function getPersona(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const personaName = args.personaName as string | undefined;
  const personasFile = (args.personasFile as string) ?? DEFAULT_PERSONAS_FILE;

  if (!personaName) return fmtError(ErrorCodes.PROMPT_INCOMPLETE, "personaName is required");

  try {
    const personas = await loadPersonasFile(ctx, sessionId, personasFile);
    const persona = findPersona(personas, personaName);

    if (!persona) {
      return fmtError(ErrorCodes.PERSONA_NOT_FOUND, `Persona '${personaName}' not found`, {
        requestedPersona: personaName,
        availablePersonas: personas.personas.map((p) => p.name),
      });
    }

    return formatResponse({ success: true, operation: "get_persona", persona });
  } catch (err: any) {
    return fmtError(ErrorCodes.PERSONAS_FILE_NOT_FOUND, err.message);
  }
}

async function validatePersonas(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const personasFile = (args.personasFile as string) ?? DEFAULT_PERSONAS_FILE;

  try {
    const personas = await loadPersonasFile(ctx, sessionId, personasFile, true);
    const errors = validatePersonasSchema(personas);

    if (errors.length > 0) {
      return formatResponse({
        success: false,
        operation: "validate_personas",
        valid: false,
        errors,
        source: personasFile,
      });
    }

    return formatResponse({
      success: true,
      operation: "validate_personas",
      valid: true,
      personaCount: personas.personas.length,
      personas: personas.personas.map((p) => p.name),
      source: personasFile,
    });
  } catch (err: any) {
    return fmtError(ErrorCodes.PERSONAS_INVALID_YAML, err.message);
  }
}

// ── Execute ─────────────────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const operation = (args.operation as string) ?? "compose";

  switch (operation) {
    case "compose": return compose(args, ctx);
    case "preview": return preview(args, ctx);
    case "list_personas": return listPersonas(args, ctx);
    case "get_persona": return getPersona(args, ctx);
    case "validate_personas": return validatePersonas(args, ctx);
    default:
      return fmtError("INVALID_OPERATION", `Unknown operation: ${operation}`);
  }
}

// ── Tool Definition ─────────────────────────────────────────

const personaComposeTool: Tool = {
  name: "persona_compose",
  description:
    "Compose personalized letters and content using LLM generation guided by persona definitions from YAML configuration. Supports multiple operations: compose (generate and save), preview (generate without saving), list_personas, get_persona, and validate_personas.",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["compose", "preview", "list_personas", "get_persona", "validate_personas"],
        default: "compose",
        description: "Operation to perform",
      },
      sessionId: {
        type: "string",
        description: "Session ID for sandbox isolation",
      },
      personaName: {
        type: "string",
        pattern: "^[a-z][a-z0-9-_]*$",
        description: "Identifier of the persona to use (required for compose/preview/get_persona)",
      },
      personasFile: {
        type: "string",
        default: "PERSONAS.yml",
        description: "Path to personas configuration file within sandbox",
      },
      prompt: {
        type: "object",
        description: "Content generation parameters (required for compose/preview)",
        properties: {
          subject: { type: "string", description: "Subject or topic of the letter" },
          recipient: {
            type: "object",
            properties: {
              name: { type: "string", description: "Recipient name" },
              relationship: { type: "string", description: "Relationship to sender" },
              context: { type: "string", description: "Additional context" },
            },
            required: ["name"],
          },
          purpose: {
            type: "string",
            enum: ["inform", "persuade", "request", "thank", "apologize", "congratulate", "complain", "follow-up", "introduction", "farewell", "custom"],
            description: "Primary purpose of the letter",
          },
          keyPoints: { type: "array", items: { type: "string" }, description: "Key points to include" },
          additionalInstructions: { type: "string", description: "Additional instructions for generation" },
          constraints: {
            type: "object",
            properties: {
              maxLength: { type: "integer", minimum: 50, maximum: 10000, default: 1000 },
              minLength: { type: "integer", minimum: 10, default: 100 },
              formality: { type: "string", enum: ["override", "inherit"], default: "inherit" },
              formalityLevel: { type: "integer", minimum: 1, maximum: 10 },
            },
          },
        },
        required: ["subject", "recipient", "purpose"],
      },
      output: {
        type: "object",
        description: "Output configuration (for compose operation)",
        properties: {
          format: { type: "string", enum: ["text", "markdown"], default: "text" },
          path: { type: "string", description: "Output file path" },
          filename: { type: "string", description: "Output filename" },
          includeMetadata: { type: "boolean", default: false },
          template: { type: "string", enum: ["letter", "email", "memo", "note", "raw"], default: "letter" },
        },
      },
      llmOptions: {
        type: "object",
        description: "LLM generation parameters",
        properties: {
          temperature: { type: "number", minimum: 0, maximum: 2, default: 0.7 },
          maxTokens: { type: "integer", minimum: 100, maximum: 4096, default: 1024 },
        },
      },
    },
    required: ["operation"],
  },
  execute,
};

export default personaComposeTool;
