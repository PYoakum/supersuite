import { spawn, execSync } from "child_process";
import { readFile, writeFile, unlink, stat, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, basename, extname } from "path";
import { tmpdir, homedir, platform } from "os";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Types ───────────────────────────────────────────────────

interface ModelInfo {
  name: string;
  description: string;
  size: string;
  engine: string;
}

interface Backend {
  name: string;
  type: "cli" | "recorder" | "utility";
  command: string;
  description: string;
}

interface TranscriptionSegment {
  start_ms: number;
  end_ms: number;
  text: string;
  confidence?: number | null;
}

interface TranscriptionResult {
  text: string;
  segments?: TranscriptionSegment[];
  model_used: string;
  backend_used: string;
  audio_duration_ms: number;
  processing_time_ms: number;
}

interface SttConfig {
  defaultModel: string;
  defaultRecordDuration: number;
  maxRecordDuration: number;
  enableVad: boolean;
  sampleRate: number;
  tempDir: string;
  modelCacheDir: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

// ── Constants ───────────────────────────────────────────────

const SUPPORTED_AUDIO_FORMATS = [".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm", ".mp4", ".mpeg", ".mpga"];

const MODELS: Record<string, ModelInfo> = {
  "whisper-tiny": { name: "whisper-tiny", description: "Whisper tiny model (~75MB) - fastest, lower accuracy", size: "75MB", engine: "whisper" },
  "whisper-base": { name: "whisper-base", description: "Whisper base model (~142MB) - fast, decent accuracy", size: "142MB", engine: "whisper" },
  "whisper-small": { name: "whisper-small", description: "Whisper small model (~466MB) - balanced speed/accuracy", size: "466MB", engine: "whisper" },
  "whisper-medium": { name: "whisper-medium", description: "Whisper medium model (~1.5GB) - high accuracy", size: "1.5GB", engine: "whisper" },
  "whisper-large": { name: "whisper-large", description: "Whisper large-v3 model (~3GB) - highest accuracy", size: "3GB", engine: "whisper" },
};

const DEFAULT_CONFIG: SttConfig = {
  defaultModel: "whisper-base",
  defaultRecordDuration: 30,
  maxRecordDuration: 300,
  enableVad: true,
  sampleRate: 16000,
  tempDir: join(tmpdir(), "stt-tool"),
  modelCacheDir: "",
};

// ── Module State ────────────────────────────────────────────

let config: SttConfig;
let backends: Backend[] = [];
let preferredBackend: Backend | null = null;

let initialized = false;

function initState(): void {
  config = { ...DEFAULT_CONFIG, modelCacheDir: getCacheDir() };
  backends = detectBackends();
  preferredBackend = selectPreferredBackend();
}

// ── Utility Functions ───────────────────────────────────────

function getCacheDir(): string {
  const plat = platform();
  if (plat === "darwin") return join(homedir(), "Library", "Caches", "stt-tool");
  if (plat === "win32") return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "stt-tool");
  return join(homedir(), ".cache", "stt-tool");
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function detectBackends(): Backend[] {
  const found: Backend[] = [];

  if (commandExists("whisper")) {
    found.push({ name: "whisper-cli", type: "cli", command: "whisper", description: "OpenAI Whisper CLI (Python)" });
  }
  if (commandExists("whisper-cpp") || commandExists("main")) {
    found.push({
      name: "whisper-cpp",
      type: "cli",
      command: commandExists("whisper-cpp") ? "whisper-cpp" : "main",
      description: "whisper.cpp (C++ implementation)",
    });
  }
  if (commandExists("mlx_whisper")) {
    found.push({ name: "mlx-whisper", type: "cli", command: "mlx_whisper", description: "MLX Whisper (Apple Silicon optimized)" });
  }
  if (commandExists("sox")) {
    found.push({ name: "sox", type: "recorder", command: "sox", description: "SoX audio recorder" });
  }
  if (commandExists("ffmpeg")) {
    found.push({ name: "ffmpeg", type: "utility", command: "ffmpeg", description: "FFmpeg audio utility" });
  }
  if (platform() === "darwin" && commandExists("afrecord")) {
    found.push({ name: "afrecord", type: "recorder", command: "afrecord", description: "macOS Core Audio recorder" });
  }

  return found;
}

function selectPreferredBackend(): Backend | null {
  const priority = ["mlx-whisper", "whisper-cli", "whisper-cpp"];
  for (const name of priority) {
    const backend = backends.find((b) => b.name === name && b.type === "cli");
    if (backend) return backend;
  }
  return null;
}

function selectRecorder(): Backend | null {
  const priority = ["sox", "ffmpeg", "afrecord"];
  for (const name of priority) {
    const backend = backends.find((b) => b.name === name);
    if (backend) return backend;
  }
  return null;
}

async function ensureTempDir(): Promise<void> {
  if (!existsSync(config.tempDir)) {
    await mkdir(config.tempDir, { recursive: true });
  }
}

function recordAudio(durationSeconds: number): Promise<string> {
  return new Promise(async (res, rej) => {
    await ensureTempDir();

    const recorder = selectRecorder();
    if (!recorder) {
      rej(new Error("No audio recorder available. Install sox or ffmpeg."));
      return;
    }

    const outputPath = join(config.tempDir, `recording-${Date.now()}.wav`);
    let proc: ReturnType<typeof spawn>;

    if (recorder.name === "sox") {
      proc = spawn("sox", [
        "-d", "-r", String(config.sampleRate), "-c", "1", "-b", "16",
        outputPath, "trim", "0", String(durationSeconds),
      ]);
    } else if (recorder.name === "ffmpeg") {
      const inputDevice = platform() === "darwin"
        ? ["-f", "avfoundation", "-i", ":0"]
        : ["-f", "alsa", "-i", "default"];
      proc = spawn("ffmpeg", [
        ...inputDevice,
        "-t", String(durationSeconds),
        "-ar", String(config.sampleRate),
        "-ac", "1", "-y", outputPath,
      ]);
    } else {
      // afrecord
      proc = spawn("afrecord", [
        "-d", String(durationSeconds), "-f", "WAVE",
        "-c", "1", "-r", String(config.sampleRate), outputPath,
      ]);
    }

    let stderr = "";
    proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (code === 0 && existsSync(outputPath)) {
        res(outputPath);
      } else {
        rej(new Error(`Recording failed (code ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      rej(new Error(`Recording error: ${err.message}`));
    });
  });
}

async function convertToWav(inputPath: string): Promise<string> {
  const ext = extname(inputPath).toLowerCase();
  if (ext === ".wav") return inputPath;

  if (!backends.find((b) => b.name === "ffmpeg")) {
    throw new Error("FFmpeg required for audio conversion. Install ffmpeg.");
  }

  await ensureTempDir();
  const outputPath = join(config.tempDir, `converted-${Date.now()}.wav`);

  return new Promise((res, rej) => {
    const proc = spawn("ffmpeg", [
      "-i", inputPath,
      "-ar", String(config.sampleRate),
      "-ac", "1", "-y", outputPath,
    ]);

    let stderr = "";
    proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (code === 0 && existsSync(outputPath)) {
        res(outputPath);
      } else {
        rej(new Error(`Conversion failed (code ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      rej(new Error(`Conversion error: ${err.message}`));
    });
  });
}

function transcribe(audioPath: string, options: { model?: string; return_timestamps?: boolean; language?: string } = {}): Promise<TranscriptionResult> {
  const backend = preferredBackend;
  if (!backend) throw new Error("No transcription backend available. Install whisper: pip install openai-whisper");

  const model = options.model || config.defaultModel;
  const modelName = model.replace("whisper-", "");
  const startTime = Date.now();

  return new Promise((res, rej) => {
    let proc: ReturnType<typeof spawn>;
    let args: string[];

    if (backend.name === "whisper-cli") {
      args = [audioPath, "--model", modelName, "--output_format", "json", "--output_dir", config.tempDir];
      if (options.language) args.push("--language", options.language);
      proc = spawn("whisper", args);
    } else if (backend.name === "mlx-whisper") {
      args = [audioPath, "--model", `mlx-community/whisper-${modelName}-mlx`];
      proc = spawn("mlx_whisper", args);
    } else {
      // whisper-cpp
      const modelPath = join(config.modelCacheDir, `ggml-${modelName}.bin`);
      args = ["-m", modelPath, "-f", audioPath, "-oj"];
      proc = spawn(backend.command, args);
    }

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.on("close", async (code) => {
      const processingTime = Date.now() - startTime;

      if (code !== 0) {
        rej(new Error(`Transcription failed (code ${code}): ${stderr}`));
        return;
      }

      try {
        let text = "";
        let segments: TranscriptionSegment[] = [];

        if (backend.name === "whisper-cli") {
          const jsonPath = audioPath.replace(extname(audioPath), ".json");
          const altJsonPath = join(config.tempDir, basename(audioPath).replace(extname(audioPath), ".json"));

          let jsonContent: string | undefined;
          if (existsSync(jsonPath)) {
            jsonContent = await readFile(jsonPath, "utf-8");
            await unlink(jsonPath).catch(() => {});
          } else if (existsSync(altJsonPath)) {
            jsonContent = await readFile(altJsonPath, "utf-8");
            await unlink(altJsonPath).catch(() => {});
          }

          if (jsonContent) {
            const parsed = JSON.parse(jsonContent);
            text = parsed.text || "";
            segments = (parsed.segments || []).map((s: any) => ({
              start_ms: Math.round((s.start || 0) * 1000),
              end_ms: Math.round((s.end || 0) * 1000),
              text: s.text || "",
              confidence: s.confidence || null,
            }));
          } else {
            text = stdout.trim();
          }
        } else if (backend.name === "whisper-cpp") {
          try {
            const parsed = JSON.parse(stdout);
            text = parsed.transcription?.map((s: any) => s.text).join(" ") || "";
            segments = (parsed.transcription || []).map((s: any) => ({
              start_ms: s.timestamps?.from ? parseInt(s.timestamps.from.replace(":", "")) : 0,
              end_ms: s.timestamps?.to ? parseInt(s.timestamps.to.replace(":", "")) : 0,
              text: s.text || "",
            }));
          } catch {
            text = stdout.trim();
          }
        } else {
          text = stdout.trim();
        }

        let audioDuration = 0;
        try {
          const stats = await stat(audioPath);
          audioDuration = Math.round((stats.size / 32000) * 1000);
        } catch { /* ignore */ }

        res({
          text: text.trim(),
          segments: options.return_timestamps ? segments : undefined,
          model_used: model,
          backend_used: backend.name,
          audio_duration_ms: audioDuration,
          processing_time_ms: processingTime,
        });
      } catch (err: any) {
        rej(new Error(`Failed to parse transcription output: ${err.message}`));
      }
    });

    proc.on("error", (err) => {
      rej(new Error(`Transcription process error: ${err.message}`));
    });
  });
}

// ── Action Handlers ─────────────────────────────────────────

async function handleTranscribeFile(args: Record<string, unknown>, session: { sandboxPath?: string } | null): Promise<Record<string, unknown>> {
  const audio_file = args.audio_file as string | undefined;
  const model = args.model as string | undefined;
  const return_timestamps = args.return_timestamps as boolean | undefined;
  const language = args.language as string | undefined;

  if (!audio_file) throw new Error("audio_file parameter is required");

  let filePath = audio_file;
  if (session?.sandboxPath && !audio_file.startsWith("/")) {
    filePath = join(session.sandboxPath, audio_file);
  }
  filePath = resolve(filePath);

  if (!existsSync(filePath)) throw new Error(`Audio file not found: ${filePath}`);

  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_AUDIO_FORMATS.includes(ext)) {
    throw new Error(`Unsupported audio format: ${ext}. Supported: ${SUPPORTED_AUDIO_FORMATS.join(", ")}`);
  }

  const wavPath = await convertToWav(filePath);
  const needsCleanup = wavPath !== filePath;

  try {
    const result = await transcribe(wavPath, { model, return_timestamps, language });
    return { success: true, ...result, source_file: audio_file };
  } finally {
    if (needsCleanup && existsSync(wavPath)) {
      await unlink(wavPath).catch(() => {});
    }
  }
}

async function handleTranscribeMicrophone(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const duration_seconds = (args.duration_seconds as number) ?? config.defaultRecordDuration;
  const model = args.model as string | undefined;
  const return_timestamps = args.return_timestamps as boolean | undefined;
  const language = args.language as string | undefined;

  const duration = Math.min(Math.max(1, duration_seconds), config.maxRecordDuration);
  const wavPath = await recordAudio(duration);

  try {
    const result = await transcribe(wavPath, { model, return_timestamps, language });
    return { success: true, ...result, recorded_duration_seconds: duration };
  } finally {
    if (existsSync(wavPath)) {
      await unlink(wavPath).catch(() => {});
    }
  }
}

function handleListModels(): Record<string, unknown> {
  const available = Object.values(MODELS).map((m) => ({
    ...m,
    available: preferredBackend !== null,
  }));

  return {
    success: true,
    models: available,
    default_model: config.defaultModel,
    backends: backends.map((b) => ({ name: b.name, type: b.type, description: b.description })),
    preferred_backend: preferredBackend?.name || null,
  };
}

function handleCheckBackends(): Record<string, unknown> {
  // Re-detect backends
  backends = detectBackends();
  preferredBackend = selectPreferredBackend();

  return {
    success: true,
    backends,
    preferred_transcription: preferredBackend?.name || null,
    preferred_recorder: selectRecorder()?.name || null,
    ready: preferredBackend !== null,
  };
}

// ── Execute ─────────────────────────────────────────────────

async function executeMain(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!initialized) { initState(); initialized = true; }

  const action = args.action as string;
  const session = ctx.session as { sandboxPath?: string } | null ?? null;

  try {
    let result: Record<string, unknown>;
    switch (action) {
      case "transcribe_file": result = await handleTranscribeFile(args, session); break;
      case "transcribe_microphone": result = await handleTranscribeMicrophone(args); break;
      case "list_models": result = handleListModels(); break;
      case "check_backends": result = handleCheckBackends(); break;
      default:
        return formatError(`Unknown action: ${action}. Valid actions: transcribe_file, transcribe_microphone, list_models, check_backends`);
    }
    return formatResponse(result);
  } catch (err: any) {
    return formatError(err.message);
  }
}

async function executeTranscribeAudioShortcut(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  return executeMain({ action: "transcribe_file", ...args }, ctx);
}

async function executeRecordAndTranscribeShortcut(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  return executeMain({ action: "transcribe_microphone", ...args }, ctx);
}

// ── Tool Definitions ────────────────────────────────────────

const speechToTextTool: Tool = {
  name: "speech_to_text",
  description: "Transcribe speech from audio files or microphone recording to text using Whisper models",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["transcribe_file", "transcribe_microphone", "list_models", "check_backends"],
        description: "Action to perform",
      },
      audio_file: {
        type: "string",
        description: "Path to audio file (for transcribe_file action). Supports WAV, MP3, M4A, FLAC, OGG, WebM",
      },
      duration_seconds: {
        type: "number",
        description: "Recording duration in seconds (for transcribe_microphone action). Default: 30, Max: 300",
      },
      model: {
        type: "string",
        enum: ["whisper-tiny", "whisper-base", "whisper-small", "whisper-medium", "whisper-large"],
        description: "Whisper model to use. Default: whisper-base",
      },
      language: {
        type: "string",
        description: 'Language code (e.g., "en", "es", "fr"). Auto-detected if not specified',
      },
      enable_vad: {
        type: "boolean",
        description: "Enable Voice Activity Detection to filter silence. Default: true",
      },
      return_timestamps: {
        type: "boolean",
        description: "Include word/segment timestamps in output. Default: false",
      },
    },
    required: ["action"],
  },
  execute: executeMain,
};

const sttAliasTool: Tool = {
  name: "stt",
  description: "Alias for speech_to_text tool - transcribe audio to text",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["transcribe_file", "transcribe_microphone", "list_models", "check_backends"],
        description: "Action to perform",
      },
      audio_file: { type: "string", description: "Path to audio file" },
      duration_seconds: { type: "number", description: "Recording duration" },
      model: { type: "string", description: "Whisper model to use" },
      language: { type: "string", description: "Language code" },
      return_timestamps: { type: "boolean", description: "Include timestamps" },
    },
    required: ["action"],
  },
  execute: executeMain,
};

const transcribeAudioTool: Tool = {
  name: "transcribe_audio",
  description: "Quickly transcribe an audio file to text",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      audio_file: { type: "string", description: "Path to the audio file to transcribe" },
      model: { type: "string", description: "Whisper model (tiny, base, small, medium, large)" },
      language: { type: "string", description: "Language code for transcription" },
    },
    required: ["audio_file"],
  },
  execute: executeTranscribeAudioShortcut,
};

const recordAndTranscribeTool: Tool = {
  name: "record_and_transcribe",
  description: "Record audio from microphone and transcribe to text",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      duration_seconds: { type: "number", description: "Recording duration in seconds (default: 30)" },
      model: { type: "string", description: "Whisper model to use" },
      language: { type: "string", description: "Language code" },
    },
  },
  execute: executeRecordAndTranscribeShortcut,
};

const tools: Tool[] = [speechToTextTool, sttAliasTool, transcribeAudioTool, recordAndTranscribeTool];

export default tools;
