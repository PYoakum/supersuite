import { spawn, execSync } from "child_process";
import { readFile, writeFile, unlink, mkdir, readdir, stat, copyFile } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, basename, extname, dirname } from "path";
import { tmpdir, homedir, platform } from "os";
import { fileURLToPath } from "url";
import crypto from "crypto";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Types ───────────────────────────────────────────────────

interface AudioInfo {
  duration: number;
  sampleRate: number;
  channels: number;
  codec: string | null;
}

interface AudioValidation extends AudioInfo {
  valid: boolean;
  warning?: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface VoiceCloneConfig {
  tempDir: string;
  voiceCacheDir: string;
  xttsModel: string;
  freevcModel: string;
  minReferenceSeconds: number;
  maxReferenceSeconds: number;
  optimalReferenceSeconds: number;
  timeout: number;
}

interface LanguageEntry {
  code: string;
  name: string;
}

interface SpeakerMetadata {
  speaker_id: string;
  name: string;
  source_file: string;
  duration_s: number;
  sample_rate: number;
  created_at: string;
  model: string;
}

// ── Constants ───────────────────────────────────────────────

function getCustomModelDir(): string {
  return join(__dirname, "..", "assets", "other_models", "tts");
}

const XTTS_LANGUAGES: LanguageEntry[] = [
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

const XTTS_PRESET_SPEAKERS = [
  "Ana Florence",
  "Craig Gutsy",
  "Damien Black",
  "Dionisio Schuyler",
  "Gitta Nikolina",
  "Henriette Usha",
  "Nova Hogarth",
  "Sofia Hellen",
  "Suad Qasim",
  "Tamaru Valeria",
];

const SUPPORTED_AUDIO_FORMATS = [".wav", ".mp3", ".flac", ".ogg", ".m4a", ".webm"];

const DEFAULT_CONFIG: VoiceCloneConfig = {
  tempDir: join(tmpdir(), "voice-clone-tool"),
  voiceCacheDir: "",
  xttsModel: "tts_models/multilingual/multi-dataset/xtts_v2",
  freevcModel: "voice_conversion_models/multilingual/vctk/freevc24",
  minReferenceSeconds: 3,
  maxReferenceSeconds: 30,
  optimalReferenceSeconds: 6,
  timeout: 600000,
};

// ── Module State ────────────────────────────────────────────

let vcConfig: VoiceCloneConfig;
let hasTts = false;
let ttsMethod: "direct" | "pipx" | null = null;
let hasFfmpeg = false;
const warmedUpModels = new Set<string>();
let ttsEnv: Record<string, string> = {};

let initialized = false;

function initState(): void {
  vcConfig = { ...DEFAULT_CONFIG, voiceCacheDir: getVoiceCacheDir() };

  const ttsStatus = checkTtsCli();
  hasTts = ttsStatus.available;
  ttsMethod = ttsStatus.method;
  hasFfmpeg = checkFfmpegAvailable();

  const customModelDir = getCustomModelDir();
  ttsEnv = existsSync(customModelDir) ? { TTS_HOME: customModelDir } : {};
}

// ── Utility Functions ───────────────────────────────────────

function getVoiceCacheDir(): string {
  const plat = platform();
  if (plat === "darwin") return join(homedir(), "Library", "Caches", "voice-clone");
  if (plat === "win32") return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "voice-clone");
  return join(homedir(), ".local", "share", "voice-clone");
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
    execSync("which ffprobe", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runCommand(cmd: string, args: string[], options: { timeout?: number; env?: Record<string, string> } = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout || vcConfig.timeout;
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

async function getAudioInfo(filePath: string): Promise<AudioInfo> {
  try {
    const result = await runCommand("ffprobe", [
      "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath,
    ], { timeout: 10000 });

    const info = JSON.parse(result.stdout);
    const audioStream = info.streams?.find((s: any) => s.codec_type === "audio");

    return {
      duration: parseFloat(info.format?.duration || 0),
      sampleRate: parseInt(audioStream?.sample_rate || 0),
      channels: parseInt(audioStream?.channels || 0),
      codec: audioStream?.codec_name || null,
    };
  } catch {
    return { duration: 0, sampleRate: 0, channels: 0, codec: null };
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
  const timeout = options.timeout || vcConfig.timeout;

  if (ttsMethod === "pipx") {
    return runCommand("pipx", ["run", "TTS", "tts", ...args], { ...options, env, timeout });
  }
  return runCommand("tts", args, { ...options, env, timeout });
}

async function warmupModel(model: string): Promise<void> {
  if (warmedUpModels.has(model)) return;

  await ensureDirs();
  const warmupPath = join(vcConfig.tempDir, `warmup_${Date.now()}.wav`);

  try {
    const args = ["--text", "test", "--model_name", model, "--out_path", warmupPath];
    if (model.includes("xtts")) args.push("--language_idx", "en");
    await runTts(args, { timeout: vcConfig.timeout });
    await sleep(1000);
    warmedUpModels.add(model);
  } catch (err: any) {
    console.error(`Model warmup failed for ${model}:`, err.message);
  } finally {
    await unlink(warmupPath).catch(() => {});
  }
}

async function ensureDirs(): Promise<void> {
  if (!existsSync(vcConfig.tempDir)) await mkdir(vcConfig.tempDir, { recursive: true });
  if (!existsSync(vcConfig.voiceCacheDir)) await mkdir(vcConfig.voiceCacheDir, { recursive: true });
}

function resolvePath(filePath: string | undefined, session: { sandboxPath?: string } | null): string | null {
  if (!filePath) return null;
  if (session?.sandboxPath && !filePath.startsWith("/")) {
    return resolve(join(session.sandboxPath, filePath));
  }
  return resolve(filePath);
}

async function validateReferenceAudio(filePath: string): Promise<AudioValidation> {
  if (!existsSync(filePath)) throw new Error(`Reference audio not found: ${filePath}`);

  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_AUDIO_FORMATS.includes(ext)) {
    throw new Error(`Unsupported format: ${ext}. Supported: ${SUPPORTED_AUDIO_FORMATS.join(", ")}`);
  }

  const info = await getAudioInfo(filePath);

  if (info.duration < vcConfig.minReferenceSeconds) {
    throw new Error(`Reference audio too short (${info.duration.toFixed(1)}s). Minimum: ${vcConfig.minReferenceSeconds}s`);
  }

  if (info.duration > vcConfig.maxReferenceSeconds) {
    return {
      valid: true,
      warning: `Reference audio long (${info.duration.toFixed(1)}s). Will use first ${vcConfig.maxReferenceSeconds}s.`,
      ...info,
    };
  }

  return { valid: true, ...info };
}

async function preprocessAudio(inputPath: string): Promise<string> {
  await ensureDirs();
  const outputPath = join(vcConfig.tempDir, `ref_${Date.now()}.wav`);
  await runCommand("ffmpeg", [
    "-y", "-i", inputPath,
    "-t", String(vcConfig.maxReferenceSeconds),
    "-ar", "22050", "-ac", "1", outputPath,
  ]);
  return outputPath;
}

function generateSpeakerId(referenceAudio: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(referenceAudio);
  return hash.digest("hex").slice(0, 16);
}

// ── Action Handlers ─────────────────────────────────────────

async function handleClone(args: Record<string, unknown>, session: { sandboxPath?: string } | null): Promise<Record<string, unknown>> {
  const text = args.text as string | undefined;
  const reference_audio = args.reference_audio as string | undefined;
  const language = (args.language as string) ?? "en";
  const output_format = (args.output_format as string) ?? "wav";
  const output_path = args.output_path as string | undefined;

  if (!text) throw new Error("text is required");
  if (!reference_audio) throw new Error("reference_audio is required");
  if (!hasTts) throw new Error("Coqui TTS is not installed. Install with: pipx install TTS (recommended) or pip install TTS");

  const langValid = XTTS_LANGUAGES.some((l) => l.code === language);
  if (!langValid) throw new Error(`Unsupported language: ${language}. Supported: ${XTTS_LANGUAGES.map((l) => l.code).join(", ")}`);

  await ensureDirs();

  const refPath = resolvePath(reference_audio, session)!;
  const validation = await validateReferenceAudio(refPath);
  const processedRef = await preprocessAudio(refPath);

  try {
    const ext = output_format.startsWith(".") ? output_format : `.${output_format}`;
    let finalPath: string;

    if (output_path) {
      finalPath = resolvePath(output_path, session)!;
    } else if (session?.sandboxPath) {
      finalPath = join(session.sandboxPath, `clone_output_${Date.now()}${ext}`);
    } else {
      finalPath = join(vcConfig.tempDir, `clone_output_${Date.now()}${ext}`);
    }

    const parentDir = dirname(finalPath);
    if (!existsSync(parentDir)) await mkdir(parentDir, { recursive: true });

    const tempOutput = join(vcConfig.tempDir, `clone_temp_${Date.now()}.wav`);

    await warmupModel(vcConfig.xttsModel);

    await runTts([
      "--text", text,
      "--model_name", vcConfig.xttsModel,
      "--speaker_wav", processedRef,
      "--language_idx", language,
      "--out_path", tempOutput,
    ], { timeout: vcConfig.timeout });

    if (ext !== ".wav" && hasFfmpeg) {
      await runCommand("ffmpeg", ["-y", "-i", tempOutput, "-b:a", "192k", finalPath]);
      await unlink(tempOutput).catch(() => {});
    } else {
      const content = await readFile(tempOutput);
      await writeFile(finalPath, content);
      await unlink(tempOutput).catch(() => {});
    }

    const outputInfo = await getAudioInfo(finalPath);
    const audioLevelDb = await getAudioLevel(finalPath);
    const isSilent = audioLevelDb !== null && audioLevelDb < -80;

    return {
      success: true,
      output_path: finalPath,
      duration_ms: Math.round(outputInfo.duration * 1000),
      max_volume_db: audioLevelDb,
      is_silent: isSilent,
      text_length: text.length,
      language,
      reference_duration_s: validation.duration,
      warning: isSilent ? "Audio output appears to be silent" : (validation.warning || undefined),
      model_used: vcConfig.xttsModel,
    };
  } finally {
    await unlink(processedRef).catch(() => {});
  }
}

async function handleConvert(args: Record<string, unknown>, session: { sandboxPath?: string } | null): Promise<Record<string, unknown>> {
  const source_audio = args.source_audio as string | undefined;
  const target_audio = args.target_audio as string | undefined;
  const output_path = args.output_path as string | undefined;

  if (!source_audio) throw new Error("source_audio is required");
  if (!target_audio) throw new Error("target_audio is required");
  if (!hasTts) throw new Error("Coqui TTS is not installed. Install with: pipx install TTS (recommended) or pip install TTS");

  await ensureDirs();

  const sourcePath = resolvePath(source_audio, session)!;
  const targetPath = resolvePath(target_audio, session)!;

  if (!existsSync(sourcePath)) throw new Error(`Source audio not found: ${source_audio}`);
  if (!existsSync(targetPath)) throw new Error(`Target audio not found: ${target_audio}`);

  const sourceInfo = await getAudioInfo(sourcePath);
  const targetInfo = await getAudioInfo(targetPath);

  let finalPath: string;
  if (output_path) {
    finalPath = resolvePath(output_path, session)!;
  } else if (session?.sandboxPath) {
    finalPath = join(session.sandboxPath, `convert_${Date.now()}.wav`);
  } else {
    finalPath = join(vcConfig.tempDir, `convert_${Date.now()}.wav`);
  }

  const parentDir = dirname(finalPath);
  if (!existsSync(parentDir)) await mkdir(parentDir, { recursive: true });

  await warmupModel(vcConfig.freevcModel);

  await runTts([
    "--model_name", vcConfig.freevcModel,
    "--source_wav", sourcePath,
    "--target_wav", targetPath,
    "--out_path", finalPath,
  ], { timeout: vcConfig.timeout });

  const outputInfo = await getAudioInfo(finalPath);
  const audioLevelDb = await getAudioLevel(finalPath);
  const isSilent = audioLevelDb !== null && audioLevelDb < -80;

  return {
    success: true,
    output_path: finalPath,
    duration_ms: Math.round(outputInfo.duration * 1000),
    max_volume_db: audioLevelDb,
    is_silent: isSilent,
    source_duration_s: sourceInfo.duration,
    target_duration_s: targetInfo.duration,
    model_used: vcConfig.freevcModel,
    warning: isSilent ? "Audio output appears to be silent" : undefined,
  };
}

async function handleSynthesize(args: Record<string, unknown>, session: { sandboxPath?: string } | null): Promise<Record<string, unknown>> {
  const text = args.text as string | undefined;
  const speaker_id = args.speaker_id as string | undefined;
  const preset_speaker = args.preset_speaker as string | undefined;
  const language = (args.language as string) ?? "en";
  const output_format = (args.output_format as string) ?? "wav";
  const output_path = args.output_path as string | undefined;

  if (!text) throw new Error("text is required");
  if (!hasTts) throw new Error("Coqui TTS is not installed. Install with: pipx install TTS (recommended) or pip install TTS");

  await ensureDirs();

  const ext = output_format.startsWith(".") ? output_format : `.${output_format}`;
  let finalPath: string;

  if (output_path) {
    finalPath = resolvePath(output_path, session)!;
  } else if (session?.sandboxPath) {
    finalPath = join(session.sandboxPath, `synth_${Date.now()}${ext}`);
  } else {
    finalPath = join(vcConfig.tempDir, `synth_${Date.now()}${ext}`);
  }

  const parentDir = dirname(finalPath);
  if (!existsSync(parentDir)) await mkdir(parentDir, { recursive: true });

  const tempOutput = join(vcConfig.tempDir, `synth_temp_${Date.now()}.wav`);

  const ttsArgs = [
    "--text", text,
    "--model_name", vcConfig.xttsModel,
    "--language_idx", language,
    "--out_path", tempOutput,
  ];

  if (speaker_id) {
    const speakerPath = join(vcConfig.voiceCacheDir, speaker_id, "reference.wav");
    if (!existsSync(speakerPath)) {
      throw new Error(`Speaker not found: ${speaker_id}. Use list_speakers to see cached speakers.`);
    }
    ttsArgs.push("--speaker_wav", speakerPath);
  } else if (preset_speaker) {
    if (!XTTS_PRESET_SPEAKERS.includes(preset_speaker)) {
      throw new Error(`Unknown preset speaker: ${preset_speaker}. Available: ${XTTS_PRESET_SPEAKERS.join(", ")}`);
    }
    ttsArgs.push("--speaker_idx", preset_speaker);
  }

  await warmupModel(vcConfig.xttsModel);
  await runTts(ttsArgs, { timeout: vcConfig.timeout });

  if (ext !== ".wav" && hasFfmpeg) {
    await runCommand("ffmpeg", ["-y", "-i", tempOutput, "-b:a", "192k", finalPath]);
    await unlink(tempOutput).catch(() => {});
  } else {
    const content = await readFile(tempOutput);
    await writeFile(finalPath, content);
    await unlink(tempOutput).catch(() => {});
  }

  const outputInfo = await getAudioInfo(finalPath);
  const audioLevelDb = await getAudioLevel(finalPath);
  const isSilent = audioLevelDb !== null && audioLevelDb < -80;

  return {
    success: true,
    output_path: finalPath,
    duration_ms: Math.round(outputInfo.duration * 1000),
    max_volume_db: audioLevelDb,
    is_silent: isSilent,
    text_length: text.length,
    language,
    speaker: speaker_id || preset_speaker || "default",
    warning: isSilent ? "Audio output appears to be silent" : undefined,
  };
}

async function handleExtractSpeaker(args: Record<string, unknown>, session: { sandboxPath?: string } | null): Promise<Record<string, unknown>> {
  const reference_audio = args.reference_audio as string | undefined;
  const speaker_id = args.speaker_id as string | undefined;
  const name = args.name as string | undefined;
  const consent = args.consent as boolean | undefined;

  if (!reference_audio) throw new Error("reference_audio is required");
  if (!consent) throw new Error("consent flag required to confirm you have permission to clone this voice");

  await ensureDirs();

  const refPath = resolvePath(reference_audio, session)!;
  const validation = await validateReferenceAudio(refPath);

  const speakerId = speaker_id || generateSpeakerId(refPath);
  const speakerDir = join(vcConfig.voiceCacheDir, speakerId);

  if (!existsSync(speakerDir)) await mkdir(speakerDir, { recursive: true });

  const processedRef = await preprocessAudio(refPath);
  const savedRefPath = join(speakerDir, "reference.wav");
  await copyFile(processedRef, savedRefPath);
  await unlink(processedRef).catch(() => {});

  const metadata: SpeakerMetadata = {
    speaker_id: speakerId,
    name: name || speakerId,
    source_file: basename(refPath),
    duration_s: validation.duration,
    sample_rate: validation.sampleRate,
    created_at: new Date().toISOString(),
    model: vcConfig.xttsModel,
  };

  await writeFile(join(speakerDir, "metadata.json"), JSON.stringify(metadata, null, 2));

  return {
    success: true,
    speaker_id: speakerId,
    name: metadata.name,
    reference_path: savedRefPath,
    duration_s: validation.duration,
    warning: validation.warning || undefined,
  };
}

async function handleListSpeakers(): Promise<Record<string, unknown>> {
  await ensureDirs();

  const speakers: Record<string, unknown>[] = [];

  try {
    const dirs = await readdir(vcConfig.voiceCacheDir);

    for (const dir of dirs) {
      const metaPath = join(vcConfig.voiceCacheDir, dir, "metadata.json");
      if (existsSync(metaPath)) {
        try {
          const meta: SpeakerMetadata = JSON.parse(await readFile(metaPath, "utf-8"));
          speakers.push({
            speaker_id: meta.speaker_id,
            name: meta.name,
            duration_s: meta.duration_s,
            created_at: meta.created_at,
            type: "cached",
          });
        } catch { /* skip malformed metadata */ }
      }
    }
  } catch { /* no speakers yet */ }

  for (const preset of XTTS_PRESET_SPEAKERS) {
    speakers.push({ speaker_id: preset, name: preset, type: "preset" });
  }

  return {
    success: true,
    speakers,
    cached_count: speakers.filter((s) => s.type === "cached").length,
    preset_count: XTTS_PRESET_SPEAKERS.length,
    voice_cache_dir: vcConfig.voiceCacheDir,
  };
}

async function handleDeleteSpeaker(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const speaker_id = args.speaker_id as string | undefined;
  if (!speaker_id) throw new Error("speaker_id is required");

  if (XTTS_PRESET_SPEAKERS.includes(speaker_id)) {
    throw new Error("Cannot delete preset speaker");
  }

  const speakerDir = join(vcConfig.voiceCacheDir, speaker_id);
  if (!existsSync(speakerDir)) throw new Error(`Speaker not found: ${speaker_id}`);

  const files = await readdir(speakerDir);
  for (const file of files) {
    await unlink(join(speakerDir, file)).catch(() => {});
  }
  await unlink(speakerDir).catch(() => {});

  return { success: true, deleted_speaker: speaker_id };
}

function handleListLanguages(): Record<string, unknown> {
  return { success: true, languages: XTTS_LANGUAGES, count: XTTS_LANGUAGES.length };
}

async function handleValidateAudio(args: Record<string, unknown>, session: { sandboxPath?: string } | null): Promise<Record<string, unknown>> {
  const audio_path = args.audio_path as string | undefined;
  if (!audio_path) throw new Error("audio_path is required");

  const filePath = resolvePath(audio_path, session)!;

  if (!existsSync(filePath)) {
    return { success: true, valid: false, error: "File not found" };
  }

  try {
    const validation = await validateReferenceAudio(filePath);
    return {
      success: true,
      valid: true,
      duration_s: validation.duration,
      sample_rate: validation.sampleRate,
      channels: validation.channels,
      codec: validation.codec,
      optimal: validation.duration >= vcConfig.optimalReferenceSeconds,
      warning: validation.warning || undefined,
    };
  } catch (err: any) {
    return { success: true, valid: false, error: err.message };
  }
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
    ffmpeg_available: hasFfmpeg,
    gpu_available: hasGpu,
    ready: hasTts && hasFfmpeg,
    xtts_model: vcConfig.xttsModel,
    freevc_model: vcConfig.freevcModel,
    voice_cache_dir: vcConfig.voiceCacheDir,
    min_reference_seconds: vcConfig.minReferenceSeconds,
    max_reference_seconds: vcConfig.maxReferenceSeconds,
    optimal_reference_seconds: vcConfig.optimalReferenceSeconds,
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
      case "clone": result = await handleClone(args, session); break;
      case "convert": result = await handleConvert(args, session); break;
      case "synthesize": result = await handleSynthesize(args, session); break;
      case "extract_speaker": result = await handleExtractSpeaker(args, session); break;
      case "list_speakers": result = await handleListSpeakers(); break;
      case "delete_speaker": result = await handleDeleteSpeaker(args); break;
      case "list_languages": result = handleListLanguages(); break;
      case "validate_audio": result = await handleValidateAudio(args, session); break;
      case "check_backends": result = await handleCheckBackends(); break;
      default:
        return formatError(`Unknown action: ${action}. Valid actions: clone, convert, synthesize, extract_speaker, list_speakers, delete_speaker, list_languages, validate_audio, check_backends`);
    }
    return formatResponse(result);
  } catch (err: any) {
    return formatError(err.message);
  }
}

async function executeCloneShortcut(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  return executeMain({
    action: "clone",
    text: args.text,
    reference_audio: args.reference,
    language: args.language,
    output_format: args.format,
    output_path: args.output_path,
  }, ctx);
}

async function executeConvertShortcut(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  return executeMain({
    action: "convert",
    source_audio: args.source,
    target_audio: args.target,
    output_path: args.output_path,
  }, ctx);
}

// ── Tool Definitions ────────────────────────────────────────

const voiceCloneTool: Tool = {
  name: "voice_clone",
  description: "Voice cloning and synthesis using Coqui TTS XTTS v2 - clone voices from reference audio",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["clone", "convert", "synthesize", "extract_speaker", "list_speakers", "delete_speaker", "list_languages", "validate_audio", "check_backends"],
        description: "Action to perform",
      },
      text: { type: "string", description: "Text to synthesize (for clone/synthesize actions)" },
      reference_audio: { type: "string", description: "Path to reference audio for voice cloning (6+ seconds recommended)" },
      source_audio: { type: "string", description: "Source audio for voice conversion" },
      target_audio: { type: "string", description: "Target voice audio for conversion" },
      speaker_id: { type: "string", description: "Cached speaker ID" },
      preset_speaker: { type: "string", description: "XTTS preset speaker name" },
      language: { type: "string", description: "Language code (default: en)" },
      output_format: { type: "string", enum: ["wav", "mp3", "ogg"], description: "Output audio format" },
      output_path: { type: "string", description: "Path for output file" },
      name: { type: "string", description: "Friendly name for cached speaker" },
      consent: { type: "boolean", description: "Confirm permission to clone voice (required for extract_speaker)" },
      audio_path: { type: "string", description: "Audio file to validate" },
    },
    required: ["action"],
  },
  execute: executeMain,
};

const cloneVoiceTool: Tool = {
  name: "clone_voice",
  description: "Quick voice cloning - synthesize speech with a cloned voice",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to speak" },
      reference: { type: "string", description: "Reference audio file path" },
      language: { type: "string", description: "Language code (default: en)" },
      format: { type: "string", description: "Output format (wav, mp3)" },
      output_path: { type: "string", description: "Output file path" },
    },
    required: ["text", "reference"],
  },
  execute: executeCloneShortcut,
};

const convertVoiceTool: Tool = {
  name: "convert_voice",
  description: "Convert voice in audio to match target speaker voice",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "Source audio with content to keep" },
      target: { type: "string", description: "Target audio with voice to match" },
      output_path: { type: "string", description: "Output file path" },
    },
    required: ["source", "target"],
  },
  execute: executeConvertShortcut,
};

const tools: Tool[] = [voiceCloneTool, cloneVoiceTool, convertVoiceTool];

export default tools;
