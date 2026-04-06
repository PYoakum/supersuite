import { spawn, execSync } from "child_process";
import { writeFile, unlink, stat, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, basename, extname, dirname } from "path";
import { tmpdir } from "os";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ────────────────────────────────────────────────

const SUPPORTED_FORMATS = [".wav", ".mp3", ".ogg", ".flac", ".aac", ".m4a", ".aiff", ".wma"];

const DEFAULT_CONFIG = {
  tempDir: join(tmpdir(), "edit-audio-tool"),
  defaultSampleRate: 44100,
  defaultChannels: 2,
  defaultBitrate: "192k",
  timeout: 300000,
};

// ── Helpers ──────────────────────────────────────────────────

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

function parseTime(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") return value;

  const str = String(value).trim();

  if (str.endsWith("ms")) {
    return parseFloat(str.slice(0, -2)) / 1000;
  }

  if (str.includes(":")) {
    const parts = str.split(":");
    let seconds = 0;
    if (parts.length === 3) {
      seconds = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
      seconds = parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return seconds;
  }

  return parseFloat(str);
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(3);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.padStart(6, "0")}`;
}

function runFfmpeg(args: string[], timeout = DEFAULT_CONFIG.timeout): Promise<{ success: boolean }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);

    let stderr = "";
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
        resolve({ success: true });
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

interface FfprobeResult {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    sample_rate?: string;
    channels?: number;
    bits_per_sample?: number;
  }>;
  format?: {
    duration?: string;
    bit_rate?: string;
    size?: string;
    format_name?: string;
  };
}

function runFfprobe(filePath: string): Promise<FfprobeResult> {
  return new Promise((resolve, reject) => {
    const args = ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath];

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
          resolve(JSON.parse(stdout));
        } catch (e: any) {
          reject(new Error(`Failed to parse ffprobe output: ${e.message}`));
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

// ── State ────────────────────────────────────────────────────

const hasFfmpeg = checkFfmpeg();
const hasFfprobe = checkFfprobe();

// ── Internal Helpers ─────────────────────────────────────────

async function ensureTempDir(): Promise<void> {
  if (!existsSync(DEFAULT_CONFIG.tempDir)) {
    await mkdir(DEFAULT_CONFIG.tempDir, { recursive: true });
  }
}

interface Session {
  sandboxPath?: string;
}

function resolvePath(filePath: string | undefined, session: Session | null): string | null {
  if (!filePath) return null;
  if (session?.sandboxPath && !filePath.startsWith("/")) {
    return resolve(join(session.sandboxPath, filePath));
  }
  return resolve(filePath);
}

async function getOutputPath(
  inputPath: string,
  suffix: string,
  outputPath: string | undefined,
  session: Session | null
): Promise<string> {
  if (outputPath) {
    return resolvePath(outputPath, session)!;
  }
  await ensureTempDir();
  const ext = extname(inputPath);
  const base = basename(inputPath, ext);
  return join(DEFAULT_CONFIG.tempDir, `${base}_${suffix}_${Date.now()}${ext}`);
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

// ── Action Handlers ──────────────────────────────────────────

async function handleInfo(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path } = args as { input_path?: string };
  if (!input_path) throw new Error("input_path is required");

  const filePath = resolvePath(input_path, session)!;
  validateAudioFile(filePath);

  const info = await runFfprobe(filePath);
  const audioStream = info.streams?.find((s) => s.codec_type === "audio");
  const format = info.format || {};

  return {
    success: true,
    file_path: input_path,
    duration_ms: Math.round(parseFloat(format.duration || "0") * 1000),
    duration_formatted: formatTime(parseFloat(format.duration || "0")),
    sample_rate: parseInt(audioStream?.sample_rate || "0"),
    channels: audioStream?.channels ?? 0,
    bit_depth: audioStream?.bits_per_sample || null,
    codec: audioStream?.codec_name || null,
    bitrate_kbps: Math.round(parseInt(format.bit_rate || "0") / 1000),
    file_size_bytes: parseInt(format.size || "0"),
    format: format.format_name || null,
  };
}

async function handleSlice(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path, start, end, output_path } = args as {
    input_path?: string;
    start?: unknown;
    end?: unknown;
    output_path?: string;
  };
  if (!input_path) throw new Error("input_path is required");
  if (start === undefined && end === undefined) {
    throw new Error("At least one of start or end is required");
  }

  const inputFile = resolvePath(input_path, session)!;
  validateAudioFile(inputFile);

  const outputFile = await getOutputPath(inputFile, "slice", output_path, session);

  const ffmpegArgs = ["-i", inputFile];
  if (start !== undefined) ffmpegArgs.push("-ss", String(parseTime(start)));
  if (end !== undefined) ffmpegArgs.push("-to", String(parseTime(end)));
  ffmpegArgs.push("-c", "copy", outputFile);

  await runFfmpeg(ffmpegArgs);

  const info = await runFfprobe(outputFile);
  const duration = parseFloat(info.format?.duration || "0");

  return {
    success: true,
    output_path: outputFile,
    duration_ms: Math.round(duration * 1000),
    operation: "slice",
    start: parseTime(start),
    end: parseTime(end),
  };
}

async function handleTrimSilence(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path, threshold_db = -50, min_duration = 0.1, output_path } = args as {
    input_path?: string;
    threshold_db?: number;
    min_duration?: number;
    output_path?: string;
  };
  if (!input_path) throw new Error("input_path is required");

  const inputFile = resolvePath(input_path, session)!;
  validateAudioFile(inputFile);

  const outputFile = await getOutputPath(inputFile, "trimmed", output_path, session);

  const filter = `silenceremove=start_periods=1:start_silence=${min_duration}:start_threshold=${threshold_db}dB,areverse,silenceremove=start_periods=1:start_silence=${min_duration}:start_threshold=${threshold_db}dB,areverse`;
  await runFfmpeg(["-i", inputFile, "-af", filter, outputFile]);

  const info = await runFfprobe(outputFile);
  const duration = parseFloat(info.format?.duration || "0");

  return {
    success: true,
    output_path: outputFile,
    duration_ms: Math.round(duration * 1000),
    operation: "trim_silence",
    threshold_db,
    min_duration,
  };
}

async function handleConcat(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_paths, crossfade_ms = 0, output_path } = args as {
    input_paths?: string[];
    crossfade_ms?: number;
    output_path?: string;
  };
  if (!input_paths || !Array.isArray(input_paths) || input_paths.length < 2) {
    throw new Error("input_paths array with at least 2 files is required");
  }

  const inputFiles = input_paths.map((p) => {
    const resolved = resolvePath(p, session)!;
    validateAudioFile(resolved);
    return resolved;
  });

  await ensureTempDir();
  const outputFile = await getOutputPath(inputFiles[0], "concat", output_path, session);

  if (crossfade_ms > 0) {
    const crossfadeSec = crossfade_ms / 1000;
    let filterComplex = "";
    let currentInput = "[0:a]";

    for (let i = 1; i < inputFiles.length; i++) {
      const nextInput = `[${i}:a]`;
      const outputLabel = i === inputFiles.length - 1 ? "" : `[a${i}]`;
      filterComplex += `${currentInput}${nextInput}acrossfade=d=${crossfadeSec}:c1=tri:c2=tri${outputLabel};`;
      currentInput = `[a${i}]`;
    }
    filterComplex = filterComplex.slice(0, -1);

    const ffmpegArgs = inputFiles.flatMap((f) => ["-i", f]);
    ffmpegArgs.push("-filter_complex", filterComplex, outputFile);
    await runFfmpeg(ffmpegArgs);
  } else {
    const listFile = join(DEFAULT_CONFIG.tempDir, `concat_${Date.now()}.txt`);
    const listContent = inputFiles.map((f) => `file '${f}'`).join("\n");
    await writeFile(listFile, listContent);

    try {
      await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outputFile]);
    } finally {
      await unlink(listFile).catch(() => {});
    }
  }

  const info = await runFfprobe(outputFile);
  const duration = parseFloat(info.format?.duration || "0");

  return {
    success: true,
    output_path: outputFile,
    duration_ms: Math.round(duration * 1000),
    operation: "concat",
    files_count: inputFiles.length,
    crossfade_ms,
  };
}

async function handleOverlay(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { base_path, overlay_path, offset_ms = 0, overlay_volume = 1.0, output_path } = args as {
    base_path?: string;
    overlay_path?: string;
    offset_ms?: number;
    overlay_volume?: number;
    output_path?: string;
  };
  if (!base_path) throw new Error("base_path is required");
  if (!overlay_path) throw new Error("overlay_path is required");

  const baseFile = resolvePath(base_path, session)!;
  const overlayFile = resolvePath(overlay_path, session)!;
  validateAudioFile(baseFile);
  validateAudioFile(overlayFile);

  const outputFile = await getOutputPath(baseFile, "overlay", output_path, session);

  const delayFilter = offset_ms > 0 ? `adelay=${offset_ms}|${offset_ms}` : "";
  const volumeFilter = overlay_volume !== 1.0 ? `volume=${overlay_volume}` : "";

  let overlayChain = "[1:a]";
  if (delayFilter) overlayChain += delayFilter + ",";
  if (volumeFilter) overlayChain += volumeFilter + ",";
  overlayChain = overlayChain.replace(/,$/, "");
  if (overlayChain === "[1:a]") {
    overlayChain = "[1:a]anull";
  }
  overlayChain += "[delayed]";

  const filterComplex = `${overlayChain};[0:a][delayed]amix=inputs=2:duration=longest:normalize=0`;
  await runFfmpeg(["-i", baseFile, "-i", overlayFile, "-filter_complex", filterComplex, outputFile]);

  const info = await runFfprobe(outputFile);
  const duration = parseFloat(info.format?.duration || "0");

  return {
    success: true,
    output_path: outputFile,
    duration_ms: Math.round(duration * 1000),
    operation: "overlay",
    offset_ms,
    overlay_volume,
  };
}

async function handleVolume(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path, gain_db, output_path } = args as {
    input_path?: string;
    gain_db?: number;
    output_path?: string;
  };
  if (!input_path) throw new Error("input_path is required");
  if (gain_db === undefined) throw new Error("gain_db is required");

  const inputFile = resolvePath(input_path, session)!;
  validateAudioFile(inputFile);

  const outputFile = await getOutputPath(inputFile, "volume", output_path, session);
  await runFfmpeg(["-i", inputFile, "-af", `volume=${gain_db}dB`, outputFile]);

  const info = await runFfprobe(outputFile);
  const duration = parseFloat(info.format?.duration || "0");

  return { success: true, output_path: outputFile, duration_ms: Math.round(duration * 1000), operation: "volume", gain_db };
}

async function handleNormalize(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path, target_lufs = -16, output_path } = args as {
    input_path?: string;
    target_lufs?: number;
    output_path?: string;
  };
  if (!input_path) throw new Error("input_path is required");

  const inputFile = resolvePath(input_path, session)!;
  validateAudioFile(inputFile);

  const outputFile = await getOutputPath(inputFile, "normalized", output_path, session);
  const filter = `loudnorm=I=${target_lufs}:TP=-1.5:LRA=11`;
  await runFfmpeg(["-i", inputFile, "-af", filter, outputFile]);

  const info = await runFfprobe(outputFile);
  const duration = parseFloat(info.format?.duration || "0");

  return { success: true, output_path: outputFile, duration_ms: Math.round(duration * 1000), operation: "normalize", target_lufs };
}

async function handleFade(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path, fade_in_ms = 0, fade_out_ms = 0, curve = "tri", output_path } = args as {
    input_path?: string;
    fade_in_ms?: number;
    fade_out_ms?: number;
    curve?: string;
    output_path?: string;
  };
  if (!input_path) throw new Error("input_path is required");
  if (!fade_in_ms && !fade_out_ms) {
    throw new Error("At least one of fade_in_ms or fade_out_ms is required");
  }

  const inputFile = resolvePath(input_path, session)!;
  validateAudioFile(inputFile);

  const outputFile = await getOutputPath(inputFile, "fade", output_path, session);

  const inputInfo = await runFfprobe(inputFile);
  const duration = parseFloat(inputInfo.format?.duration || "0");

  const filters: string[] = [];
  if (fade_in_ms > 0) {
    filters.push(`afade=t=in:st=0:d=${fade_in_ms / 1000}:curve=${curve}`);
  }
  if (fade_out_ms > 0) {
    const fadeOutStart = duration - fade_out_ms / 1000;
    filters.push(`afade=t=out:st=${fadeOutStart}:d=${fade_out_ms / 1000}:curve=${curve}`);
  }

  await runFfmpeg(["-i", inputFile, "-af", filters.join(","), outputFile]);

  return {
    success: true,
    output_path: outputFile,
    duration_ms: Math.round(duration * 1000),
    operation: "fade",
    fade_in_ms,
    fade_out_ms,
    curve,
  };
}

async function handlePan(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path, position = 0, output_path } = args as {
    input_path?: string;
    position?: number;
    output_path?: string;
  };
  if (!input_path) throw new Error("input_path is required");

  const inputFile = resolvePath(input_path, session)!;
  validateAudioFile(inputFile);

  const outputFile = await getOutputPath(inputFile, "pan", output_path, session);

  const leftGain = Math.min(1, 1 - position);
  const rightGain = Math.min(1, 1 + position);
  const filter = `pan=stereo|c0=${leftGain}*c0|c1=${rightGain}*c1`;
  await runFfmpeg(["-i", inputFile, "-af", filter, outputFile]);

  const info = await runFfprobe(outputFile);
  const duration = parseFloat(info.format?.duration || "0");

  return { success: true, output_path: outputFile, duration_ms: Math.round(duration * 1000), operation: "pan", position };
}

async function handleSpeed(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path, factor, output_path } = args as {
    input_path?: string;
    factor?: number;
    output_path?: string;
  };
  if (!input_path) throw new Error("input_path is required");
  if (!factor) throw new Error("factor is required");
  if (factor < 0.5 || factor > 2.0) {
    throw new Error("factor must be between 0.5 and 2.0");
  }

  const inputFile = resolvePath(input_path, session)!;
  validateAudioFile(inputFile);

  const outputFile = await getOutputPath(inputFile, "speed", output_path, session);
  await runFfmpeg(["-i", inputFile, "-af", `atempo=${factor}`, outputFile]);

  const info = await runFfprobe(outputFile);
  const duration = parseFloat(info.format?.duration || "0");

  return { success: true, output_path: outputFile, duration_ms: Math.round(duration * 1000), operation: "speed", factor };
}

async function handleTempo(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path, factor, output_path } = args as {
    input_path?: string;
    factor?: number;
    output_path?: string;
  };
  if (!input_path) throw new Error("input_path is required");
  if (!factor) throw new Error("factor is required");

  const inputFile = resolvePath(input_path, session)!;
  validateAudioFile(inputFile);

  const outputFile = await getOutputPath(inputFile, "tempo", output_path, session);

  const tempoFilters: string[] = [];
  let remaining = factor;

  while (remaining > 2.0) {
    tempoFilters.push("atempo=2.0");
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    tempoFilters.push("atempo=0.5");
    remaining /= 0.5;
  }
  tempoFilters.push(`atempo=${remaining}`);

  await runFfmpeg(["-i", inputFile, "-af", tempoFilters.join(","), outputFile]);

  const info = await runFfprobe(outputFile);
  const duration = parseFloat(info.format?.duration || "0");

  return { success: true, output_path: outputFile, duration_ms: Math.round(duration * 1000), operation: "tempo", factor };
}

async function handleHighpass(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path, frequency, output_path } = args as {
    input_path?: string;
    frequency?: number;
    output_path?: string;
  };
  if (!input_path) throw new Error("input_path is required");
  if (!frequency) throw new Error("frequency is required");

  const inputFile = resolvePath(input_path, session)!;
  validateAudioFile(inputFile);

  const outputFile = await getOutputPath(inputFile, "highpass", output_path, session);
  await runFfmpeg(["-i", inputFile, "-af", `highpass=f=${frequency}`, outputFile]);

  const info = await runFfprobe(outputFile);
  const duration = parseFloat(info.format?.duration || "0");

  return { success: true, output_path: outputFile, duration_ms: Math.round(duration * 1000), operation: "highpass", frequency };
}

async function handleLowpass(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path, frequency, output_path } = args as {
    input_path?: string;
    frequency?: number;
    output_path?: string;
  };
  if (!input_path) throw new Error("input_path is required");
  if (!frequency) throw new Error("frequency is required");

  const inputFile = resolvePath(input_path, session)!;
  validateAudioFile(inputFile);

  const outputFile = await getOutputPath(inputFile, "lowpass", output_path, session);
  await runFfmpeg(["-i", inputFile, "-af", `lowpass=f=${frequency}`, outputFile]);

  const info = await runFfprobe(outputFile);
  const duration = parseFloat(info.format?.duration || "0");

  return { success: true, output_path: outputFile, duration_ms: Math.round(duration * 1000), operation: "lowpass", frequency };
}

async function handleEq(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path, frequency, gain_db, q = 1.0, output_path } = args as {
    input_path?: string;
    frequency?: number;
    gain_db?: number;
    q?: number;
    output_path?: string;
  };
  if (!input_path) throw new Error("input_path is required");
  if (!frequency) throw new Error("frequency is required");
  if (gain_db === undefined) throw new Error("gain_db is required");

  const inputFile = resolvePath(input_path, session)!;
  validateAudioFile(inputFile);

  const outputFile = await getOutputPath(inputFile, "eq", output_path, session);
  const filter = `equalizer=f=${frequency}:width_type=q:width=${q}:g=${gain_db}`;
  await runFfmpeg(["-i", inputFile, "-af", filter, outputFile]);

  const info = await runFfprobe(outputFile);
  const duration = parseFloat(info.format?.duration || "0");

  return { success: true, output_path: outputFile, duration_ms: Math.round(duration * 1000), operation: "eq", frequency, gain_db, q };
}

async function handleEcho(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path, delay_ms = 500, decay = 0.5, output_path } = args as {
    input_path?: string;
    delay_ms?: number;
    decay?: number;
    output_path?: string;
  };
  if (!input_path) throw new Error("input_path is required");

  const inputFile = resolvePath(input_path, session)!;
  validateAudioFile(inputFile);

  const outputFile = await getOutputPath(inputFile, "echo", output_path, session);
  const filter = `aecho=0.8:0.88:${delay_ms}:${decay}`;
  await runFfmpeg(["-i", inputFile, "-af", filter, outputFile]);

  const info = await runFfprobe(outputFile);
  const duration = parseFloat(info.format?.duration || "0");

  return { success: true, output_path: outputFile, duration_ms: Math.round(duration * 1000), operation: "echo", delay_ms, decay };
}

async function handleChorus(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path, depth = 0.5, rate = 1.0, output_path } = args as {
    input_path?: string;
    depth?: number;
    rate?: number;
    output_path?: string;
  };
  if (!input_path) throw new Error("input_path is required");

  const inputFile = resolvePath(input_path, session)!;
  validateAudioFile(inputFile);

  const outputFile = await getOutputPath(inputFile, "chorus", output_path, session);
  const filter = `chorus=0.5:0.9:50|60|40:0.4|0.32|0.3:0.25|0.4|0.3:2|2.3|1.3`;
  await runFfmpeg(["-i", inputFile, "-af", filter, outputFile]);

  const info = await runFfprobe(outputFile);
  const duration = parseFloat(info.format?.duration || "0");

  return { success: true, output_path: outputFile, duration_ms: Math.round(duration * 1000), operation: "chorus", depth, rate };
}

async function handleConvert(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path, output_format, sample_rate, channels, bitrate, output_path } = args as {
    input_path?: string;
    output_format?: string;
    sample_rate?: number;
    channels?: number;
    bitrate?: string;
    output_path?: string;
  };
  if (!input_path) throw new Error("input_path is required");
  if (!output_format) throw new Error("output_format is required");

  const inputFile = resolvePath(input_path, session)!;
  validateAudioFile(inputFile);

  const ext = output_format.startsWith(".") ? output_format : `.${output_format}`;
  const defaultOutput = await getOutputPath(inputFile, "converted", undefined, session);
  const outputFile = output_path
    ? resolvePath(output_path, session)!
    : defaultOutput.replace(extname(defaultOutput), ext);

  const ffmpegArgs = ["-i", inputFile];
  if (sample_rate) ffmpegArgs.push("-ar", String(sample_rate));
  if (channels) ffmpegArgs.push("-ac", String(channels));
  if (bitrate) ffmpegArgs.push("-b:a", bitrate);
  ffmpegArgs.push(outputFile);

  await runFfmpeg(ffmpegArgs);

  const info = await runFfprobe(outputFile);
  const duration = parseFloat(info.format?.duration || "0");

  return {
    success: true,
    output_path: outputFile,
    duration_ms: Math.round(duration * 1000),
    operation: "convert",
    output_format: ext,
    sample_rate,
    channels,
    bitrate,
  };
}

async function handlePipeline(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { input_path, operations, output_path } = args as {
    input_path?: string;
    operations?: Array<Record<string, unknown>>;
    output_path?: string;
  };
  if (!input_path) throw new Error("input_path is required");
  if (!operations || !Array.isArray(operations) || operations.length === 0) {
    throw new Error("operations array is required");
  }

  let currentInput = resolvePath(input_path, session)!;
  validateAudioFile(currentInput);

  const tempFiles: string[] = [];
  const appliedOps: string[] = [];
  const originalInput = currentInput;

  try {
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const isLast = i === operations.length - 1;
      const opOutput = isLast && output_path ? resolvePath(output_path, session) : undefined;

      const opArgs: Record<string, unknown> = {
        ...op,
        input_path: currentInput,
        output_path: opOutput,
      };

      let result: any;
      switch (op.action) {
        case "slice": result = await handleSlice(opArgs, session); break;
        case "trim_silence": result = await handleTrimSilence(opArgs, session); break;
        case "volume": result = await handleVolume(opArgs, session); break;
        case "normalize": result = await handleNormalize(opArgs, session); break;
        case "fade": result = await handleFade(opArgs, session); break;
        case "pan": result = await handlePan(opArgs, session); break;
        case "speed": result = await handleSpeed(opArgs, session); break;
        case "tempo": result = await handleTempo(opArgs, session); break;
        case "highpass": result = await handleHighpass(opArgs, session); break;
        case "lowpass": result = await handleLowpass(opArgs, session); break;
        case "eq": result = await handleEq(opArgs, session); break;
        case "echo": result = await handleEcho(opArgs, session); break;
        case "chorus": result = await handleChorus(opArgs, session); break;
        default: throw new Error(`Unknown pipeline operation: ${op.action}`);
      }

      if (!isLast && currentInput !== originalInput) {
        tempFiles.push(currentInput);
      }

      currentInput = result.output_path;
      appliedOps.push(op.action as string);
    }

    for (const tempFile of tempFiles) {
      await unlink(tempFile).catch(() => {});
    }

    const info = await runFfprobe(currentInput);
    const duration = parseFloat(info.format?.duration || "0");

    return {
      success: true,
      output_path: currentInput,
      duration_ms: Math.round(duration * 1000),
      operation: "pipeline",
      operations_applied: appliedOps,
    };
  } catch (error) {
    for (const tempFile of tempFiles) {
      await unlink(tempFile).catch(() => {});
    }
    throw error;
  }
}

async function handleCheckBackends(): Promise<unknown> {
  return {
    success: true,
    ffmpeg_available: hasFfmpeg,
    ffprobe_available: hasFfprobe,
    ready: hasFfmpeg && hasFfprobe,
    supported_formats: SUPPORTED_FORMATS,
  };
}

// ── Main Execute ─────────────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!hasFfmpeg) {
    return formatError("FFmpeg is not installed. Please install ffmpeg.");
  }

  const { action } = args as { action?: string };
  const session: Session | null = args.sessionId
    ? { sandboxPath: await ctx.sandbox.ensureSandbox(args.sessionId as string) }
    : null;

  try {
    let result: unknown;
    switch (action) {
      case "info": result = await handleInfo(args, session); break;
      case "slice": result = await handleSlice(args, session); break;
      case "trim_silence": result = await handleTrimSilence(args, session); break;
      case "concat": result = await handleConcat(args, session); break;
      case "overlay": result = await handleOverlay(args, session); break;
      case "volume": result = await handleVolume(args, session); break;
      case "normalize": result = await handleNormalize(args, session); break;
      case "fade": result = await handleFade(args, session); break;
      case "pan": result = await handlePan(args, session); break;
      case "speed": result = await handleSpeed(args, session); break;
      case "tempo": result = await handleTempo(args, session); break;
      case "highpass": result = await handleHighpass(args, session); break;
      case "lowpass": result = await handleLowpass(args, session); break;
      case "eq": result = await handleEq(args, session); break;
      case "echo": result = await handleEcho(args, session); break;
      case "chorus": result = await handleChorus(args, session); break;
      case "convert": result = await handleConvert(args, session); break;
      case "pipeline": result = await handlePipeline(args, session); break;
      case "check_backends": result = await handleCheckBackends(); break;
      default:
        return formatError(
          `Unknown action: ${action}. Valid actions: info, slice, trim_silence, concat, overlay, volume, normalize, fade, pan, speed, tempo, highpass, lowpass, eq, echo, chorus, convert, pipeline, check_backends`
        );
    }
    return formatResponse(result);
  } catch (err: any) {
    return formatError(err.message);
  }
}

// ── Input Schema ─────────────────────────────────────────────

const inputSchema = {
  type: "object" as const,
  properties: {
    action: {
      type: "string",
      enum: [
        "info", "slice", "trim_silence", "concat", "overlay", "volume", "normalize",
        "fade", "pan", "speed", "tempo", "highpass", "lowpass", "eq", "echo",
        "chorus", "convert", "pipeline", "check_backends",
      ],
      description: "Audio editing action to perform",
    },
    input_path: { type: "string", description: "Path to input audio file" },
    input_paths: { type: "array", items: { type: "string" }, description: "Array of input paths for concat action" },
    output_path: { type: "string", description: "Path for output file (auto-generated if not provided)" },
    start: { type: ["number", "string"], description: 'Start time for slice (seconds, "HH:MM:SS", or "5000ms")' },
    end: { type: ["number", "string"], description: "End time for slice" },
    gain_db: { type: "number", description: "Volume gain in decibels (-60 to +20)" },
    target_lufs: { type: "number", description: "Target loudness in LUFS for normalize (default: -16)" },
    fade_in_ms: { type: "number", description: "Fade in duration in milliseconds" },
    fade_out_ms: { type: "number", description: "Fade out duration in milliseconds" },
    position: { type: "number", description: "Pan position: -1 (left) to 1 (right), 0 = center" },
    factor: { type: "number", description: "Speed/tempo factor (0.5 to 2.0)" },
    frequency: { type: "number", description: "Filter frequency in Hz" },
    q: { type: "number", description: "EQ Q factor (bandwidth)" },
    delay_ms: { type: "number", description: "Echo delay in milliseconds" },
    decay: { type: "number", description: "Echo decay factor (0 to 1)" },
    base_path: { type: "string", description: "Base audio path for overlay" },
    overlay_path: { type: "string", description: "Overlay audio path" },
    offset_ms: { type: "number", description: "Overlay offset in milliseconds" },
    overlay_volume: { type: "number", description: "Overlay volume multiplier" },
    crossfade_ms: { type: "number", description: "Crossfade duration for concat" },
    output_format: { type: "string", description: "Output format for convert (wav, mp3, ogg, flac)" },
    sample_rate: { type: "number", description: "Sample rate for convert" },
    channels: { type: "number", description: "Channel count for convert (1=mono, 2=stereo)" },
    bitrate: { type: "string", description: 'Bitrate for convert (e.g., "192k")' },
    operations: { type: "array", description: "Array of operations for pipeline action" },
    threshold_db: { type: "number", description: "Silence threshold in dB for trim_silence" },
  },
  required: ["action"],
};

// ── Tool Definitions ─────────────────────────────────────────

const editAudioTool: Tool = {
  name: "edit_audio",
  description:
    "Edit audio files using ffmpeg - slice, trim, concatenate, overlay, adjust volume, apply effects, and convert formats",
  needsSandbox: true,
  inputSchema,
  execute,
};

const audioEditTool: Tool = {
  name: "audio_edit",
  description: "Alias for edit_audio tool",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "Audio editing action" },
      input_path: { type: "string", description: "Input audio file" },
      output_path: { type: "string", description: "Output file path" },
    },
    required: ["action"],
  },
  execute,
};

export default [editAudioTool, audioEditTool];
