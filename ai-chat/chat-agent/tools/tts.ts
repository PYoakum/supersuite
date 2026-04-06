import { spawn, execSync } from "child_process";
import { readFile, writeFile, unlink, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, extname, dirname } from "path";
import { tmpdir, homedir, platform } from "os";
import { fileURLToPath } from "url";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Types ───────────────────────────────────────────────────

interface TtsModelInfo {
  name: string;
  description: string;
  language: string;
  quality: string;
  multi_speaker: boolean;
}

interface LanguageEntry {
  code: string;
  name: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface TtsConfig {
  tempDir: string;
  modelCacheDir: string | null;
  defaultModel: string;
  defaultSampleRate: number;
  maxTextLength: number;
  chunkSize: number;
  timeout: number;
}

// ── Constants ───────────────────────────────────────────────

function getCustomModelDir(): string {
  return join(__dirname, "..", "assets", "other_models", "tts");
}

const COMMON_MODELS: Record<string, TtsModelInfo> = {
  fast_en: {
    name: "tts_models/en/ljspeech/glow-tts",
    description: "Fast English synthesis (LJSpeech Glow-TTS)",
    language: "en",
    quality: "fast",
    multi_speaker: false,
  },
  fast_en_vits: {
    name: "tts_models/en/ljspeech/vits",
    description: "Fast English VITS (end-to-end)",
    language: "en",
    quality: "fast",
    multi_speaker: false,
  },
  vctk_vits: {
    name: "tts_models/en/vctk/vits",
    description: "High quality English with 100+ speakers",
    language: "en",
    quality: "high",
    multi_speaker: true,
  },
  xtts_v2: {
    name: "tts_models/multilingual/multi-dataset/xtts_v2",
    description: "XTTS v2 - Multilingual with voice cloning",
    language: "multilingual",
    quality: "high",
    multi_speaker: true,
  },
  your_tts: {
    name: "tts_models/multilingual/multi-dataset/your_tts",
    description: "YourTTS - Multilingual voice transfer",
    language: "multilingual",
    quality: "high",
    multi_speaker: true,
  },
  tacotron2_en: {
    name: "tts_models/en/ljspeech/tacotron2-DDC",
    description: "Tacotron2 DDC English",
    language: "en",
    quality: "balanced",
    multi_speaker: false,
  },
};

const COMMON_LANGUAGES: LanguageEntry[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "pl", name: "Polish" },
  { code: "tr", name: "Turkish" },
  { code: "ru", name: "Russian" },
  { code: "nl", name: "Dutch" },
  { code: "cs", name: "Czech" },
  { code: "ar", name: "Arabic" },
  { code: "zh-cn", name: "Chinese (Simplified)" },
  { code: "ja", name: "Japanese" },
  { code: "hu", name: "Hungarian" },
  { code: "ko", name: "Korean" },
  { code: "hi", name: "Hindi" },
];

const DEFAULT_CONFIG: TtsConfig = {
  tempDir: join(tmpdir(), "tts-tool"),
  modelCacheDir: null,
  defaultModel: "tts_models/en/ljspeech/vits",
  defaultSampleRate: 22050,
  maxTextLength: 5000,
  chunkSize: 500,
  timeout: 300000,
};

// ── Module State ────────────────────────────────────────────

let config: TtsConfig;
let hasTts = false;
let ttsMethod: "direct" | "pipx" | null = null;
let hasFfmpeg = false;
let modelCache: string[] | null = null;
const warmedUpModels = new Set<string>();
let ttsEnv: Record<string, string> = {};

function initState(): void {
  config = { ...DEFAULT_CONFIG, modelCacheDir: getModelCacheDir() };

  const ttsStatus = checkTtsCli();
  hasTts = ttsStatus.available;
  ttsMethod = ttsStatus.method;
  hasFfmpeg = checkFfmpegAvailable();

  const customModelDir = getCustomModelDir();
  ttsEnv = existsSync(customModelDir) ? { TTS_HOME: customModelDir } : {};
}

// ── Utility Functions ───────────────────────────────────────

function getModelCacheDir(): string {
  const plat = platform();
  if (plat === "darwin") return join(homedir(), "Library", "Caches", "tts");
  if (plat === "win32") return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "tts");
  return join(homedir(), ".local", "share", "tts");
}

function checkTtsCli(): { available: boolean; method: "direct" | "pipx" | null } {
  try {
    execSync("which tts", { stdio: "ignore" });
    return { available: true, method: "direct" };
  } catch { /* not directly available */ }

  try {
    execSync("which pipx", { stdio: "ignore" });
    const result = execSync("pipx list", { encoding: "utf-8" });
    if (result.includes("tts") || result.includes("TTS")) {
      return { available: true, method: "pipx" };
    }
    return { available: true, method: "pipx" };
  } catch { /* pipx not available */ }

  return { available: false, method: null };
}

function checkFfmpegAvailable(): boolean {
  try {
    execSync("which ffmpeg", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runCommand(cmd: string, args: string[], options: { timeout?: number; env?: Record<string, string> } = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout || config.timeout;
    const proc = spawn(cmd, args, { env: { ...process.env, ...options.env } });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Command timed out: ${cmd}`));
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${cmd} failed (code ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`${cmd} error: ${err.message}`));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const result = await runCommand("ffprobe", [
      "-v", "quiet", "-print_format", "json", "-show_format", filePath,
    ], { timeout: 10000 });
    const info = JSON.parse(result.stdout);
    return parseFloat(info.format?.duration || 0) * 1000;
  } catch {
    return 0;
  }
}

async function getAudioLevel(filePath: string): Promise<number | null> {
  try {
    const result = await runCommand("ffmpeg", [
      "-i", filePath, "-af", "volumedetect", "-f", "null", "-",
    ], { timeout: 30000 });
    const maxMatch = result.stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);
    return maxMatch ? parseFloat(maxMatch[1]) : null;
  } catch {
    return null;
  }
}

async function runTts(args: string[], options: { timeout?: number; env?: Record<string, string> } = {}): Promise<CommandResult> {
  const env = { ...ttsEnv, ...options.env };
  const timeout = options.timeout || config.timeout;

  if (ttsMethod === "pipx") {
    return runCommand("pipx", ["run", "TTS", "tts", ...args], { ...options, env, timeout });
  }
  return runCommand("tts", args, { ...options, env, timeout });
}

async function warmupModel(model: string): Promise<void> {
  if (warmedUpModels.has(model)) return;

  await ensureTempDir();
  const warmupPath = join(config.tempDir, `warmup_${Date.now()}.wav`);

  try {
    await runTts(["--text", "test", "--model_name", model, "--out_path", warmupPath], { timeout: config.timeout });
    await sleep(1000);
    warmedUpModels.add(model);
  } catch (err: any) {
    console.error(`Model warmup failed for ${model}:`, err.message);
  } finally {
    await unlink(warmupPath).catch(() => {});
  }
}

async function ensureTempDir(): Promise<void> {
  if (!existsSync(config.tempDir)) {
    await mkdir(config.tempDir, { recursive: true });
  }
}

function resolveModel(modelName: string | undefined): string {
  if (!modelName) return config.defaultModel;

  if (COMMON_MODELS[modelName]) return COMMON_MODELS[modelName].name;
  if (modelName.includes("/")) return modelName;

  const lower = modelName.toLowerCase();
  for (const [key, model] of Object.entries(COMMON_MODELS)) {
    if (key.toLowerCase().includes(lower) || model.name.toLowerCase().includes(lower)) {
      return model.name;
    }
  }

  return modelName;
}

async function getModelList(): Promise<string[]> {
  if (modelCache) return modelCache;

  try {
    const result = await runTts(["--list_models"], { timeout: 30000 });
    const lines = result.stdout.split("\n");
    const models: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("tts_models/") || trimmed.startsWith("vocoder_models/")) {
        models.push(trimmed);
      }
    }

    modelCache = models;
    return models;
  } catch {
    return Object.values(COMMON_MODELS).map((m) => m.name);
  }
}

function splitText(text: string, maxLength: number = config.chunkSize): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = maxLength;
    const sentenceEnders = [". ", "! ", "? ", ".\n", "!\n", "?\n"];

    for (const ender of sentenceEnders) {
      const lastEnder = remaining.lastIndexOf(ender, maxLength);
      if (lastEnder > maxLength / 2) {
        splitIndex = lastEnder + ender.length;
        break;
      }
    }

    if (splitIndex === maxLength) {
      const lastSpace = remaining.lastIndexOf(" ", maxLength);
      if (lastSpace > maxLength / 2) {
        splitIndex = lastSpace + 1;
      }
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks;
}

async function synthesizeChunk(
  text: string,
  model: string,
  options: { speaker?: string; language?: string; outputPath: string },
): Promise<string> {
  const args = ["--text", text, "--model_name", model, "--out_path", options.outputPath];
  if (options.speaker) args.push("--speaker_idx", options.speaker);
  if (options.language) args.push("--language_idx", options.language);
  await runTts(args, { timeout: config.timeout });
  return options.outputPath;
}

async function concatenateChunks(chunkPaths: string[], outputPath: string): Promise<void> {
  if (chunkPaths.length === 1) {
    const content = await readFile(chunkPaths[0]);
    await writeFile(outputPath, content);
    return;
  }

  const listPath = join(config.tempDir, `concat_${Date.now()}.txt`);
  const listContent = chunkPaths.map((p) => `file '${p}'`).join("\n");
  await writeFile(listPath, listContent);

  try {
    await runCommand("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
  } finally {
    await unlink(listPath).catch(() => {});
  }
}

async function convertFormat(
  inputPath: string,
  outputPath: string,
  format: string,
  options: { sampleRate?: number; bitrate?: string } = {},
): Promise<void> {
  const args = ["-y", "-i", inputPath];
  if (options.sampleRate) args.push("-ar", String(options.sampleRate));
  if (format === "mp3" && options.bitrate) args.push("-b:a", options.bitrate);
  args.push(outputPath);
  await runCommand("ffmpeg", args);
}

// ── Action Handlers ─────────────────────────────────────────

async function handleSynthesize(args: Record<string, unknown>, session: { sandboxPath?: string } | null): Promise<Record<string, unknown>> {
  const text = args.text as string | undefined;
  const model = args.model as string | undefined;
  const speaker = args.speaker as string | undefined;
  const language = args.language as string | undefined;
  const output_format = (args.output_format as string) ?? "wav";
  const output_path = args.output_path as string | undefined;

  if (!text) throw new Error("text is required");
  if (!hasTts) throw new Error("Coqui TTS is not installed. Install with: pipx install TTS (recommended) or pip install TTS");
  if (text.length > config.maxTextLength) throw new Error(`Text too long (${text.length} chars). Maximum: ${config.maxTextLength}`);

  await ensureTempDir();

  const resolvedModel = resolveModel(model);
  await warmupModel(resolvedModel);

  const textChunks = splitText(text);
  const chunkPaths: string[] = [];

  try {
    for (let i = 0; i < textChunks.length; i++) {
      const chunkPath = join(config.tempDir, `chunk_${Date.now()}_${i}.wav`);
      await synthesizeChunk(textChunks[i], resolvedModel, { speaker, language, outputPath: chunkPath });
      chunkPaths.push(chunkPath);
    }

    const ext = output_format.startsWith(".") ? output_format : `.${output_format}`;
    const defaultName = `tts_output_${Date.now()}${ext}`;
    let finalPath: string;

    if (output_path) {
      finalPath = session?.sandboxPath && !output_path.startsWith("/")
        ? resolve(join(session.sandboxPath, output_path))
        : resolve(output_path);
    } else if (session?.sandboxPath) {
      finalPath = join(session.sandboxPath, defaultName);
    } else {
      finalPath = join(config.tempDir, defaultName);
    }

    const parentDir = dirname(finalPath);
    if (!existsSync(parentDir)) await mkdir(parentDir, { recursive: true });

    const concatenatedPath = join(config.tempDir, `concat_${Date.now()}.wav`);
    await concatenateChunks(chunkPaths, concatenatedPath);

    if (ext !== ".wav" && hasFfmpeg) {
      await convertFormat(concatenatedPath, finalPath, output_format.replace(".", ""), { bitrate: "192k" });
      await unlink(concatenatedPath).catch(() => {});
    } else {
      const content = await readFile(concatenatedPath);
      await writeFile(finalPath, content);
      await unlink(concatenatedPath).catch(() => {});
    }

    const durationMs = await getAudioDuration(finalPath);
    const audioLevelDb = await getAudioLevel(finalPath);
    const isSilent = audioLevelDb !== null && audioLevelDb < -80;

    return {
      success: true,
      output_path: finalPath,
      duration_ms: Math.round(durationMs),
      max_volume_db: audioLevelDb,
      is_silent: isSilent,
      characters_processed: text.length,
      chunks_processed: textChunks.length,
      model_used: resolvedModel,
      speaker_used: speaker || null,
      language_used: language || null,
      format: output_format,
      warning: isSilent ? "Audio output appears to be silent - model may not have initialized correctly" : null,
    };
  } finally {
    for (const chunkPath of chunkPaths) {
      await unlink(chunkPath).catch(() => {});
    }
  }
}

async function handleListModels(): Promise<Record<string, unknown>> {
  const allModels = await getModelList();
  const ttsModels = allModels.filter((m) => m.startsWith("tts_models/"));
  const vocoderModels = allModels.filter((m) => m.startsWith("vocoder_models/"));

  const modelsWithInfo = ttsModels.map((name) => {
    const commonEntry = Object.entries(COMMON_MODELS).find(([, m]) => m.name === name);
    if (commonEntry) {
      return { name, shorthand: commonEntry[0], ...commonEntry[1] };
    }
    const parts = name.split("/");
    return { name, language: parts[1] || "unknown", dataset: parts[2] || "unknown", architecture: parts[3] || "unknown" };
  });

  return {
    success: true,
    tts_models: modelsWithInfo,
    vocoder_models: vocoderModels,
    total_tts_models: ttsModels.length,
    total_vocoder_models: vocoderModels.length,
    recommended: Object.entries(COMMON_MODELS).map(([key, model]) => ({ shorthand: key, ...model })),
  };
}

async function handleListSpeakers(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const model = args.model as string | undefined;
  if (!model) throw new Error("model is required");

  const resolvedModel = resolveModel(model);

  try {
    const result = await runTts(["--model_name", resolvedModel, "--list_speaker_idxs"], { timeout: 60000 });
    const speakers: string[] = [];
    const lines = result.stdout.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith(">") && !trimmed.includes("model")) {
        speakers.push(trimmed);
      }
    }

    return { success: true, model: resolvedModel, speakers, speaker_count: speakers.length };
  } catch {
    return { success: true, model: resolvedModel, speakers: [], speaker_count: 0, note: "This model may not support multiple speakers" };
  }
}

function handleListLanguages(): Record<string, unknown> {
  return {
    success: true,
    languages: COMMON_LANGUAGES,
    common_count: COMMON_LANGUAGES.length,
    fairseq_note: "Additional 1100+ languages available via Fairseq VITS models (tts_models/<lang>/fairseq/vits)",
    multilingual_models: ["xtts_v2", "your_tts"],
  };
}

function handleGetModelInfo(args: Record<string, unknown>): Record<string, unknown> {
  const model = args.model as string | undefined;
  if (!model) throw new Error("model is required");

  const resolvedModel = resolveModel(model);
  const commonEntry = Object.entries(COMMON_MODELS).find(([, m]) => m.name === resolvedModel);

  if (commonEntry) {
    return { success: true, model: resolvedModel, shorthand: commonEntry[0], ...commonEntry[1] };
  }

  const parts = resolvedModel.split("/");
  return {
    success: true,
    model: resolvedModel,
    type: parts[0] || "unknown",
    language: parts[1] || "unknown",
    dataset: parts[2] || "unknown",
    architecture: parts[3] || "unknown",
  };
}

function handleRecommendModel(args: Record<string, unknown>): Record<string, unknown> {
  const language = (args.language as string) ?? "en";
  const quality = (args.quality as string) ?? "balanced";
  const multi_speaker = (args.multi_speaker as boolean) ?? false;

  const recommendations: (TtsModelInfo & { shorthand: string; score: number; note?: string })[] = [];

  for (const [key, model] of Object.entries(COMMON_MODELS)) {
    if (model.language !== "multilingual" && model.language !== language) continue;
    if (multi_speaker && !model.multi_speaker) continue;

    let score = 0;
    if (model.quality === quality) score += 10;
    if (model.language === language) score += 5;
    if (model.multi_speaker === multi_speaker) score += 3;

    recommendations.push({ shorthand: key, ...model, score });
  }

  recommendations.sort((a, b) => b.score - a.score);

  if (recommendations.length === 0 && language !== "en") {
    recommendations.push({
      shorthand: "",
      name: `tts_models/${language}/fairseq/vits`,
      description: `Fairseq VITS model for ${language}`,
      language,
      quality: "balanced",
      multi_speaker: false,
      score: 0,
      note: "Fairseq model - quality varies by language",
    });
  }

  return { success: true, recommendations: recommendations.slice(0, 5), criteria: { language, quality, multi_speaker } };
}

async function handleCheckBackends(): Promise<Record<string, unknown>> {
  let hasGpu = false;
  try {
    const result = await runCommand("python3", ["-c", "import torch; print(torch.cuda.is_available())"], { timeout: 10000 });
    hasGpu = result.stdout.trim().toLowerCase() === "true";
  } catch { /* no GPU */ }

  return {
    success: true,
    tts_available: hasTts,
    tts_method: ttsMethod,
    ffmpeg_available: hasFfmpeg,
    gpu_available: hasGpu,
    ready: hasTts,
    model_cache_dir: config.modelCacheDir,
    temp_dir: config.tempDir,
    default_model: config.defaultModel,
  };
}

// ── Execute ─────────────────────────────────────────────────

// Lazy init on first call
let initialized = false;

async function executeMain(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!initialized) { initState(); initialized = true; }

  const action = args.action as string;
  const session = ctx.session as { sandboxPath?: string } | null ?? null;

  try {
    let result: Record<string, unknown>;
    switch (action) {
      case "synthesize": result = await handleSynthesize(args, session); break;
      case "list_models": result = await handleListModels(); break;
      case "list_speakers": result = await handleListSpeakers(args); break;
      case "list_languages": result = handleListLanguages(); break;
      case "get_model_info": result = handleGetModelInfo(args); break;
      case "recommend_model": result = handleRecommendModel(args); break;
      case "check_backends": result = await handleCheckBackends(); break;
      default:
        return formatError(`Unknown action: ${action}. Valid actions: synthesize, list_models, list_speakers, list_languages, get_model_info, recommend_model, check_backends`);
    }
    return formatResponse(result);
  } catch (err: any) {
    return formatError(err.message);
  }
}

async function executeSpeakShortcut(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  return executeMain({
    action: "synthesize",
    text: args.text,
    model: args.model ?? "fast_en_vits",
    speaker: args.speaker,
    language: args.language,
    output_format: args.format,
    output_path: args.output_path,
  }, ctx);
}

// ── Tool Definitions ────────────────────────────────────────

const ttsInputSchema: Tool["inputSchema"] = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["synthesize", "list_models", "list_speakers", "list_languages", "get_model_info", "recommend_model", "check_backends"],
      description: "Action to perform",
    },
    text: { type: "string", description: "Text to synthesize (for synthesize action)" },
    model: { type: "string", description: 'TTS model name or shorthand (e.g., "vctk_vits", "xtts_v2")' },
    speaker: { type: "string", description: "Speaker ID for multi-speaker models" },
    language: { type: "string", description: 'Language code for multilingual models (e.g., "en", "es", "fr")' },
    output_format: { type: "string", enum: ["wav", "mp3", "ogg"], description: "Output audio format (default: wav)" },
    output_path: { type: "string", description: "Relative path for output file (saved in sandbox). Omit to auto-generate." },
    quality: { type: "string", enum: ["fast", "balanced", "high"], description: "Quality tier for model recommendation" },
    multi_speaker: { type: "boolean", description: "Require multi-speaker model (for recommend_model)" },
  },
  required: ["action"],
};

const ttsTool: Tool = {
  name: "tts",
  description: "Text-to-speech synthesis using Coqui TTS with multiple models and 1100+ languages. Output files are saved to your sandbox directory. Use relative paths for output_path.",
  needsSandbox: false,
  inputSchema: ttsInputSchema,
  execute: executeMain,
};

const textToSpeechTool: Tool = {
  name: "text_to_speech",
  description: "Alias for tts tool - convert text to speech audio",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "Action to perform" },
      text: { type: "string", description: "Text to synthesize" },
      model: { type: "string", description: "TTS model" },
    },
    required: ["action"],
  },
  execute: executeMain,
};

const speakTool: Tool = {
  name: "speak",
  description: "Quick text-to-speech synthesis. Output files are saved to your sandbox directory.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to speak" },
      model: { type: "string", description: "TTS model (default: fast_en_vits)" },
      speaker: { type: "string", description: "Speaker ID" },
      language: { type: "string", description: "Language code" },
      format: { type: "string", description: "Output format" },
      output_path: { type: "string", description: "Relative path for output file (saved in sandbox). Omit to auto-generate." },
    },
    required: ["text"],
  },
  execute: executeSpeakShortcut,
};

const tools: Tool[] = [ttsTool, textToSpeechTool, speakTool];

export default tools;
