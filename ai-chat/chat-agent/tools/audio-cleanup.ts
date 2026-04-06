import { spawn, execSync } from "child_process";
import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, basename, extname, dirname } from "path";
import { tmpdir } from "os";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ────────────────────────────────────────────────

const SUPPORTED_FORMATS = [".wav", ".mp3", ".ogg", ".flac", ".aac", ".m4a"];

const DEFAULT_CONFIG = {
  tempDir: join(tmpdir(), "audio-cleanup-tool"),
  silenceThresholdDb: -40,
  minSilenceDuration: 0.3,
  defaultGapMs: 200,
  timeout: 300_000,
  defaultSampleRate: 44100,
  defaultChannels: 2,
};

// ── Types ────────────────────────────────────────────────────

interface AudioConfig {
  tempDir: string;
  silenceThresholdDb: number;
  minSilenceDuration: number;
  defaultGapMs: number;
  timeout: number;
  defaultSampleRate: number;
  defaultChannels: number;
}

interface FfmpegResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

interface SilenceRegion {
  start: number;
  end: number;
  duration: number;
}

interface SessionInfo {
  sandboxPath?: string;
  [key: string]: unknown;
}

// ── FFmpeg Helpers ────────────────────────────────────────────

function checkFfmpeg(): boolean {
  try {
    execSync("which ffmpeg", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function checkFfprobe(): boolean {
  try {
    execSync("which ffprobe", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runFfmpeg(args: string[], timeout = DEFAULT_CONFIG.timeout): Promise<FfmpegResult> {
  return new Promise((res, reject) => {
    const proc = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "info", ...args]);

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("FFmpeg operation timed out"));
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        res({ success: true, stdout, stderr });
      } else {
        reject(new Error(`FFmpeg failed (code ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg error: ${err.message}`));
    });
  });
}

function runFfprobe(filePath: string): Promise<Record<string, unknown>> {
  return new Promise((res, reject) => {
    const args = [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ];

    const proc = spawn("ffprobe", args);
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          res(JSON.parse(stdout));
        } catch (e) {
          reject(new Error(`Failed to parse ffprobe output: ${(e as Error).message}`));
        }
      } else {
        reject(new Error(`ffprobe failed: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`ffprobe error: ${err.message}`));
    });
  });
}

async function detectSilence(
  filePath: string,
  thresholdDb = -40,
  minDuration = 0.3
): Promise<SilenceRegion[]> {
  const args = [
    "-i", filePath,
    "-af", `silencedetect=noise=${thresholdDb}dB:d=${minDuration}`,
    "-f", "null",
    "-",
  ];

  const result = await runFfmpeg(args);
  const silenceRegions: SilenceRegion[] = [];

  const lines = result.stderr.split("\n");
  let currentStart: number | null = null;

  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    const endMatch = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);

    if (startMatch) {
      currentStart = parseFloat(startMatch[1]);
    }

    if (endMatch && currentStart !== null) {
      silenceRegions.push({
        start: currentStart,
        end: parseFloat(endMatch[1]),
        duration: parseFloat(endMatch[2]),
      });
      currentStart = null;
    }
  }

  return silenceRegions;
}

async function getAudioDuration(filePath: string): Promise<number> {
  const info = await runFfprobe(filePath);
  const format = info.format as Record<string, unknown> | undefined;
  return parseFloat((format?.duration as string) || "0");
}

// ── Audio Processing Helpers ─────────────────────────────────

function resolvePath(filePath: string | undefined, session: SessionInfo | null): string | null {
  if (!filePath) return null;
  if (session?.sandboxPath && !filePath.startsWith("/")) {
    return resolve(join(session.sandboxPath, filePath));
  }
  return resolve(filePath);
}

function validateAudioFile(filePath: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }
  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_FORMATS.includes(ext)) {
    throw new Error(`Unsupported format: ${ext}. Supported: ${SUPPORTED_FORMATS.join(", ")}`);
  }
}

async function ensureTempDir(config: AudioConfig): Promise<void> {
  if (!existsSync(config.tempDir)) {
    await mkdir(config.tempDir, { recursive: true });
  }
}

async function generateSilence(
  durationMs: number,
  outputPath: string,
  sampleRate = 44100
): Promise<string> {
  const durationSec = durationMs / 1000;
  await runFfmpeg([
    "-f", "lavfi",
    "-i", `anullsrc=r=${sampleRate}:cl=stereo`,
    "-t", String(durationSec),
    outputPath,
  ]);
  return outputPath;
}

async function trimSilence(
  inputPath: string,
  outputPath: string,
  options: {
    thresholdDb?: number;
    minDuration?: number;
    trimStart?: boolean;
    trimEnd?: boolean;
  } = {}
): Promise<void> {
  const {
    thresholdDb = DEFAULT_CONFIG.silenceThresholdDb,
    minDuration = DEFAULT_CONFIG.minSilenceDuration,
    trimStart = true,
    trimEnd = true,
  } = options;

  let filter = "";

  if (trimStart && trimEnd) {
    filter = `silenceremove=start_periods=1:start_silence=${minDuration}:start_threshold=${thresholdDb}dB,areverse,silenceremove=start_periods=1:start_silence=${minDuration}:start_threshold=${thresholdDb}dB,areverse`;
  } else if (trimStart) {
    filter = `silenceremove=start_periods=1:start_silence=${minDuration}:start_threshold=${thresholdDb}dB`;
  } else if (trimEnd) {
    filter = `areverse,silenceremove=start_periods=1:start_silence=${minDuration}:start_threshold=${thresholdDb}dB,areverse`;
  } else {
    await runFfmpeg(["-i", inputPath, "-c", "copy", outputPath]);
    return;
  }

  await runFfmpeg(["-i", inputPath, "-af", filter, outputPath]);
}

async function trimInternalSilence(
  inputPath: string,
  outputPath: string,
  options: { thresholdDb?: number; maxSilenceDuration?: number } = {}
): Promise<void> {
  const {
    thresholdDb = DEFAULT_CONFIG.silenceThresholdDb,
    maxSilenceDuration = 0.5,
  } = options;

  const filter = `silenceremove=stop_periods=-1:stop_duration=${maxSilenceDuration}:stop_threshold=${thresholdDb}dB`;
  await runFfmpeg(["-i", inputPath, "-af", filter, outputPath]);
}

// ── Action Handlers ──────────────────────────────────────────

async function handleAnalyze(
  args: Record<string, unknown>,
  session: SessionInfo | null,
  config: AudioConfig
): Promise<Record<string, unknown>> {
  const inputPathArg = args.input_path as string | undefined;
  if (!inputPathArg) throw new Error("input_path is required");

  const filePath = resolvePath(inputPathArg, session)!;
  validateAudioFile(filePath);

  const thresholdDb = (args.threshold_db as number) ?? config.silenceThresholdDb;
  const minDuration = (args.min_duration as number) ?? config.minSilenceDuration;

  const duration = await getAudioDuration(filePath);
  const silenceRegions = await detectSilence(filePath, thresholdDb, minDuration);

  const totalSilence = silenceRegions.reduce((sum, r) => sum + r.duration, 0);
  const speechDuration = duration - totalSilence;
  const silencePercent = (totalSilence / duration) * 100;

  const leadingSilence = silenceRegions.find((r) => r.start < 0.01);
  const trailingSilence = silenceRegions.find((r) => Math.abs(r.end - duration) < 0.01);

  return {
    success: true,
    file_path: inputPathArg,
    duration_seconds: Math.round(duration * 1000) / 1000,
    silence_regions: silenceRegions,
    silence_count: silenceRegions.length,
    total_silence_seconds: Math.round(totalSilence * 1000) / 1000,
    speech_duration_seconds: Math.round(speechDuration * 1000) / 1000,
    silence_percent: Math.round(silencePercent * 10) / 10,
    leading_silence_seconds: leadingSilence
      ? Math.round(leadingSilence.duration * 1000) / 1000
      : 0,
    trailing_silence_seconds: trailingSilence
      ? Math.round(trailingSilence.duration * 1000) / 1000
      : 0,
    threshold_db: thresholdDb,
    min_duration: minDuration,
  };
}

async function handleTrim(
  args: Record<string, unknown>,
  session: SessionInfo | null,
  config: AudioConfig
): Promise<Record<string, unknown>> {
  const inputPathArg = args.input_path as string | undefined;
  const outputPathArg = args.output_path as string | undefined;
  const trim_start = (args.trim_start as boolean) !== false;
  const trim_end = (args.trim_end as boolean) !== false;
  const trim_internal = (args.trim_internal as boolean) === true;
  const max_internal_silence = (args.max_internal_silence as number) ?? 0.5;

  if (!inputPathArg) throw new Error("input_path is required");

  const inputFile = resolvePath(inputPathArg, session)!;
  validateAudioFile(inputFile);

  await ensureTempDir(config);

  const thresholdDb = (args.threshold_db as number) ?? config.silenceThresholdDb;
  const minDuration = (args.min_duration as number) ?? config.minSilenceDuration;

  const originalDuration = await getAudioDuration(inputFile);

  let outputFile: string;
  if (outputPathArg) {
    outputFile = resolvePath(outputPathArg, session)!;
  } else {
    const ext = extname(inputFile);
    const base = basename(inputFile, ext);
    outputFile = join(config.tempDir, `${base}_cleaned_${Date.now()}${ext}`);
  }

  const outputDir = dirname(outputFile);
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  const tempFile1 = join(config.tempDir, `trim_temp1_${Date.now()}.wav`);
  await trimSilence(inputFile, tempFile1, {
    thresholdDb,
    minDuration,
    trimStart: trim_start,
    trimEnd: trim_end,
  });

  if (trim_internal) {
    await trimInternalSilence(tempFile1, outputFile, {
      thresholdDb,
      maxSilenceDuration: max_internal_silence,
    });
    await unlink(tempFile1).catch(() => {});
  } else {
    const content = await readFile(tempFile1);
    await writeFile(outputFile, content);
    await unlink(tempFile1).catch(() => {});
  }

  const newDuration = await getAudioDuration(outputFile);
  const removedDuration = originalDuration - newDuration;

  return {
    success: true,
    output_path: outputFile,
    original_duration_ms: Math.round(originalDuration * 1000),
    new_duration_ms: Math.round(newDuration * 1000),
    removed_ms: Math.round(removedDuration * 1000),
    reduction_percent: Math.round((removedDuration / originalDuration) * 1000) / 10,
    settings: {
      threshold_db: thresholdDb,
      min_duration: minDuration,
      trim_start,
      trim_end,
      trim_internal,
      max_internal_silence: trim_internal ? max_internal_silence : null,
    },
  };
}

async function handleBatchTrim(
  args: Record<string, unknown>,
  session: SessionInfo | null,
  config: AudioConfig
): Promise<Record<string, unknown>> {
  const inputPaths = args.input_paths as string[] | undefined;
  const outputDirArg = args.output_dir as string | undefined;
  const trim_start = (args.trim_start as boolean) !== false;
  const trim_end = (args.trim_end as boolean) !== false;
  const trim_internal = (args.trim_internal as boolean) === true;
  const max_internal_silence = (args.max_internal_silence as number) ?? 0.5;

  if (!inputPaths || !Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new Error("input_paths array is required");
  }

  await ensureTempDir(config);

  const thresholdDb = (args.threshold_db as number) ?? config.silenceThresholdDb;
  const minDuration = (args.min_duration as number) ?? config.minSilenceDuration;

  let outputDirectory: string;
  if (outputDirArg) {
    outputDirectory = resolvePath(outputDirArg, session)!;
  } else {
    outputDirectory = config.tempDir;
  }

  if (!existsSync(outputDirectory)) {
    await mkdir(outputDirectory, { recursive: true });
  }

  const results: Record<string, unknown>[] = [];
  let totalOriginal = 0;
  let totalNew = 0;

  for (const inputPath of inputPaths) {
    const inputFile = resolvePath(inputPath, session)!;

    try {
      validateAudioFile(inputFile);

      const ext = extname(inputFile);
      const base = basename(inputFile, ext);
      const outputFile = join(outputDirectory, `${base}_cleaned${ext}`);

      const result = await handleTrim(
        {
          input_path: inputFile,
          output_path: outputFile,
          threshold_db: thresholdDb,
          min_duration: minDuration,
          trim_start,
          trim_end,
          trim_internal,
          max_internal_silence,
        },
        session,
        config
      );

      totalOriginal += result.original_duration_ms as number;
      totalNew += result.new_duration_ms as number;

      results.push({
        input: inputPath,
        output: outputFile,
        success: true,
        original_ms: result.original_duration_ms,
        new_ms: result.new_duration_ms,
        removed_ms: result.removed_ms,
      });
    } catch (err) {
      results.push({
        input: inputPath,
        output: null,
        success: false,
        error: (err as Error).message,
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;

  return {
    success: true,
    files_processed: inputPaths.length,
    files_succeeded: successCount,
    files_failed: inputPaths.length - successCount,
    total_original_ms: totalOriginal,
    total_new_ms: totalNew,
    total_removed_ms: totalOriginal - totalNew,
    output_directory: outputDirectory,
    results,
  };
}

async function handleConcat(
  args: Record<string, unknown>,
  session: SessionInfo | null,
  config: AudioConfig
): Promise<Record<string, unknown>> {
  const inputPaths = args.input_paths as string[] | undefined;
  const outputPathArg = args.output_path as string | undefined;
  const gap_ms = args.gap_ms as number | undefined;
  const trim_clips = (args.trim_clips as boolean) !== false;
  const trim_internal = (args.trim_internal as boolean) === true;
  const max_internal_silence = (args.max_internal_silence as number) ?? 0.5;
  const crossfade_ms = (args.crossfade_ms as number) ?? 0;
  const normalize = (args.normalize as boolean) === true;

  if (!inputPaths || !Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new Error("input_paths array is required");
  }

  await ensureTempDir(config);

  const gapMs = gap_ms ?? config.defaultGapMs;
  const thresholdDb = (args.threshold_db as number) ?? config.silenceThresholdDb;
  const minDuration = (args.min_duration as number) ?? config.minSilenceDuration;

  const cleanedFiles: string[] = [];
  const tempFiles: string[] = [];
  let totalOriginal = 0;

  try {
    for (let i = 0; i < inputPaths.length; i++) {
      const inputPath = inputPaths[i];
      const inputFile = resolvePath(inputPath, session)!;
      validateAudioFile(inputFile);

      const originalDuration = await getAudioDuration(inputFile);
      totalOriginal += originalDuration * 1000;

      if (trim_clips) {
        const cleanedFile = join(config.tempDir, `cleaned_${i}_${Date.now()}.wav`);
        tempFiles.push(cleanedFile);

        const tempTrimmed = join(config.tempDir, `trimmed_${i}_${Date.now()}.wav`);
        tempFiles.push(tempTrimmed);

        await trimSilence(inputFile, tempTrimmed, {
          thresholdDb,
          minDuration,
          trimStart: true,
          trimEnd: true,
        });

        if (trim_internal) {
          await trimInternalSilence(tempTrimmed, cleanedFile, {
            thresholdDb,
            maxSilenceDuration: max_internal_silence,
          });
        } else {
          const content = await readFile(tempTrimmed);
          await writeFile(cleanedFile, content);
        }

        cleanedFiles.push(cleanedFile);
      } else {
        cleanedFiles.push(inputFile);
      }
    }

    let gapFile: string | null = null;
    if (gapMs > 0 && crossfade_ms === 0) {
      gapFile = join(config.tempDir, `gap_${Date.now()}.wav`);
      tempFiles.push(gapFile);
      await generateSilence(gapMs, gapFile);
    }

    let outputFile: string;
    if (outputPathArg) {
      outputFile = resolvePath(outputPathArg, session)!;
    } else {
      outputFile = join(config.tempDir, `concat_output_${Date.now()}.wav`);
    }

    const outputDir = dirname(outputFile);
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }

    if (crossfade_ms > 0) {
      const crossfadeSec = crossfade_ms / 1000;
      let filterComplex = "";
      let currentInput = "[0:a]";

      for (let i = 1; i < cleanedFiles.length; i++) {
        const nextInput = `[${i}:a]`;
        const outputLabel = i === cleanedFiles.length - 1 ? "" : `[a${i}]`;
        filterComplex += `${currentInput}${nextInput}acrossfade=d=${crossfadeSec}:c1=tri:c2=tri${outputLabel};`;
        currentInput = `[a${i}]`;
      }

      filterComplex = filterComplex.slice(0, -1);

      const ffmpegArgs = cleanedFiles.flatMap((f) => ["-i", f]);
      ffmpegArgs.push("-filter_complex", filterComplex, outputFile);

      await runFfmpeg(ffmpegArgs);
    } else {
      const listFile = join(config.tempDir, `concat_list_${Date.now()}.txt`);
      tempFiles.push(listFile);

      let listContent = "";
      for (let i = 0; i < cleanedFiles.length; i++) {
        listContent += `file '${cleanedFiles[i]}'\n`;
        if (gapFile && i < cleanedFiles.length - 1) {
          listContent += `file '${gapFile}'\n`;
        }
      }

      await writeFile(listFile, listContent);
      await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outputFile]);
    }

    if (normalize) {
      const normalizedFile = join(config.tempDir, `normalized_${Date.now()}.wav`);
      tempFiles.push(normalizedFile);

      await runFfmpeg([
        "-i", outputFile,
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        normalizedFile,
      ]);

      const content = await readFile(normalizedFile);
      await writeFile(outputFile, content);
    }

    const finalDuration = await getAudioDuration(outputFile);

    return {
      success: true,
      output_path: outputFile,
      clips_processed: inputPaths.length,
      total_original_ms: Math.round(totalOriginal),
      final_duration_ms: Math.round(finalDuration * 1000),
      removed_ms: Math.round(totalOriginal - finalDuration * 1000),
      settings: {
        gap_ms: gapMs,
        crossfade_ms,
        trim_clips,
        trim_internal,
        normalize,
        threshold_db: thresholdDb,
      },
    };
  } finally {
    for (const tempFile of tempFiles) {
      await unlink(tempFile).catch(() => {});
    }
  }
}

function handleCheckBackends(config: AudioConfig): Record<string, unknown> {
  const hasFfmpeg = checkFfmpeg();
  const hasFfprobe = checkFfprobe();

  return {
    success: true,
    ffmpeg_available: hasFfmpeg,
    ffprobe_available: hasFfprobe,
    ready: hasFfmpeg && hasFfprobe,
    supported_formats: SUPPORTED_FORMATS,
    default_settings: {
      silence_threshold_db: config.silenceThresholdDb,
      min_silence_duration: config.minSilenceDuration,
      default_gap_ms: config.defaultGapMs,
    },
  };
}

// ── Main handler ─────────────────────────────────────────────

async function handle(
  args: Record<string, unknown>,
  config: AudioConfig,
  session: SessionInfo | null
): Promise<Record<string, unknown>> {
  if (!checkFfmpeg()) {
    throw new Error("FFmpeg is not installed. Please install ffmpeg.");
  }

  const action = args.action as string;

  switch (action) {
    case "analyze":
      return handleAnalyze(args, session, config);
    case "trim":
      return handleTrim(args, session, config);
    case "batch_trim":
      return handleBatchTrim(args, session, config);
    case "concat":
      return handleConcat(args, session, config);
    case "check_backends":
      return handleCheckBackends(config);
    default:
      throw new Error(
        `Unknown action: ${action}. Valid actions: analyze, trim, batch_trim, concat, check_backends`
      );
  }
}

// ── Execute wrappers ─────────────────────────────────────────

function getAudioConfig(ctx: ToolContext): AudioConfig {
  return {
    tempDir: (ctx.config.audioTempDir as string) ?? DEFAULT_CONFIG.tempDir,
    silenceThresholdDb: (ctx.config.silenceThresholdDb as number) ?? DEFAULT_CONFIG.silenceThresholdDb,
    minSilenceDuration: (ctx.config.minSilenceDuration as number) ?? DEFAULT_CONFIG.minSilenceDuration,
    defaultGapMs: (ctx.config.defaultGapMs as number) ?? DEFAULT_CONFIG.defaultGapMs,
    timeout: (ctx.config.audioTimeout as number) ?? DEFAULT_CONFIG.timeout,
    defaultSampleRate: (ctx.config.defaultSampleRate as number) ?? DEFAULT_CONFIG.defaultSampleRate,
    defaultChannels: (ctx.config.defaultChannels as number) ?? DEFAULT_CONFIG.defaultChannels,
  };
}

async function executeAudioCleanup(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const config = getAudioConfig(ctx);
  const session = (ctx.config._session as SessionInfo | undefined) ?? null;

  try {
    const result = await handle(args, config, session);
    return formatResponse(result);
  } catch (err) {
    return formatError((err as Error).message);
  }
}

async function executeTrimSilence(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const config = getAudioConfig(ctx);
  const session = (ctx.config._session as SessionInfo | undefined) ?? null;

  try {
    const result = await handle(
      {
        action: "trim",
        input_path: args.input_path,
        output_path: args.output_path,
        threshold_db: args.threshold_db,
        trim_start: true,
        trim_end: true,
        trim_internal: (args.trim_internal as boolean) || false,
      },
      config,
      session
    );
    return formatResponse(result);
  } catch (err) {
    return formatError((err as Error).message);
  }
}

// ── Tool Definitions ─────────────────────────────────────────

const audioCleanupTool: Tool = {
  name: "audio_cleanup",
  description:
    "Clean up dead air (silence) in speech audio files - analyze, trim, and concatenate with consistent gaps",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["analyze", "trim", "batch_trim", "concat", "check_backends"],
        description:
          "Action to perform: analyze (detect silence), trim (single file), batch_trim (multiple files), concat (trim and join)",
      },
      input_path: {
        type: "string",
        description: "Path to input audio file (for analyze, trim)",
      },
      input_paths: {
        type: "array",
        items: { type: "string" },
        description: "Array of input audio file paths (for batch_trim, concat)",
      },
      output_path: {
        type: "string",
        description: "Path for output file",
      },
      output_dir: {
        type: "string",
        description: "Output directory for batch_trim",
      },
      threshold_db: {
        type: "number",
        description: "Silence threshold in dB (default: -40, lower = more sensitive)",
      },
      min_duration: {
        type: "number",
        description: "Minimum silence duration to detect in seconds (default: 0.3)",
      },
      trim_start: {
        type: "boolean",
        description: "Trim silence from start (default: true)",
      },
      trim_end: {
        type: "boolean",
        description: "Trim silence from end (default: true)",
      },
      trim_internal: {
        type: "boolean",
        description: "Also trim internal silence/long pauses (default: false)",
      },
      max_internal_silence: {
        type: "number",
        description:
          "Maximum internal silence to keep in seconds when trim_internal=true (default: 0.5)",
      },
      trim_clips: {
        type: "boolean",
        description: "Trim each clip before concatenating (default: true)",
      },
      gap_ms: {
        type: "number",
        description: "Gap between clips in milliseconds for concat (default: 200)",
      },
      crossfade_ms: {
        type: "number",
        description: "Crossfade duration in milliseconds (0 = no crossfade)",
      },
      normalize: {
        type: "boolean",
        description: "Normalize loudness after concatenation (default: false)",
      },
    },
    required: ["action"],
  },
  execute: executeAudioCleanup,
};

const cleanAudioTool: Tool = {
  name: "clean_audio",
  description: "Alias for audio_cleanup - remove dead air from speech audio",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "Action to perform" },
      input_path: { type: "string", description: "Input audio file" },
      input_paths: {
        type: "array",
        items: { type: "string" },
        description: "Input audio files",
      },
      output_path: { type: "string", description: "Output file path" },
    },
    required: ["action"],
  },
  execute: executeAudioCleanup,
};

const trimSilenceTool: Tool = {
  name: "trim_silence",
  description: "Quick tool to trim silence from audio file",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      input_path: { type: "string", description: "Input audio file" },
      output_path: { type: "string", description: "Output file path" },
      threshold_db: { type: "number", description: "Silence threshold in dB" },
      trim_internal: { type: "boolean", description: "Also trim internal pauses" },
    },
    required: ["input_path"],
  },
  execute: executeTrimSilence,
};

export default [audioCleanupTool, cleanAudioTool, trimSilenceTool] as Tool[];
