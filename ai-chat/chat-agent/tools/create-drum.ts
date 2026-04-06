import { spawn, execSync } from "child_process";
import { writeFile, unlink, mkdir } from "fs/promises";
import { existsSync, createWriteStream } from "fs";
import { join, resolve, dirname } from "path";
import { tmpdir, homedir, platform } from "os";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── External Host References ─────────────────────────────────

const DRUM_SAMPLES_URL = "https://raw.githubusercontent.com/emanuelefavero/drum-machine-808/master/sounds/";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BUNDLED_SAMPLES_DIR = join(__dirname, "..", "assets", "audio", "drums808");

// ── Types ────────────────────────────────────────────────────

interface SampleInfo {
  name: string;
  file: string;
  category: string;
  aliases: string[];
  bundled: boolean;
}

interface PatternStep {
  step: number;
  velocity: number;
}

interface ParsedTrack {
  sample: SampleInfo;
  steps: PatternStep[];
  totalSteps: number;
}

interface TimingEvent {
  sample: SampleInfo;
  timestampMs: number;
  velocity: number;
}

interface Timing {
  events: TimingEvent[];
  totalSteps: number;
  totalDurationMs: number;
  stepDurationMs: number;
}

interface Session {
  sandboxPath?: string;
}

// ── Constants ────────────────────────────────────────────────

const SAMPLE_MAP: Record<string, SampleInfo> = {
  BD: { name: "kick", file: "bd.mp3", category: "kicks", aliases: ["kick", "bass_drum", "bd"], bundled: true },
  SD: { name: "snare", file: "sd.mp3", category: "snares", aliases: ["snare", "sd"], bundled: true },
  CP: { name: "clap", file: "cp.mp3", category: "percussion", aliases: ["clap", "cp", "handclap"], bundled: true },
  CH: { name: "hihat-closed", file: "hc.mp3", category: "hihats", aliases: ["hihat", "hh", "closed_hihat", "ch"], bundled: true },
  OH: { name: "hihat-open", file: "ho.mp3", category: "hihats", aliases: ["open_hihat", "oh"], bundled: true },
  CB: { name: "cowbell", file: "cb.mp3", category: "percussion", aliases: ["cowbell", "cb"], bundled: true },
  RS: { name: "rimshot", file: "rs.mp3", category: "percussion", aliases: ["rimshot", "rs", "rim"], bundled: true },
};

const PRESET_PATTERNS: Record<string, { name: string; description: string; bpm: number; pattern: string }> = {
  basic_rock: {
    name: "Basic Rock",
    description: "Simple rock beat with kick on 1 and 3, snare on 2 and 4",
    bpm: 120,
    pattern: `BD x---x---|x---x---
SD ----|x---|----|x---
CH x-x-|x-x-|x-x-|x-x-`,
  },
  four_on_floor: {
    name: "Four on the Floor",
    description: "Classic house/disco beat with kick on every quarter note",
    bpm: 128,
    pattern: `BD x---|x---|x---|x---
CH x-x-|x-x-|x-x-|x-x-
OH ----|---x|----|---x`,
  },
  boom_bap: {
    name: "Boom Bap",
    description: "Classic hip-hop beat with syncopated kick",
    bpm: 90,
    pattern: `BD x--x|----|x--x|----
SD ----|x---|----|x---
CH x-x-|x-x-|x-x-|x-x-`,
  },
  trap: {
    name: "Trap",
    description: "Modern trap beat with fast hi-hats and 808",
    bpm: 140,
    pattern: `BD x---|----|----|--x-
SD ----|x---|----|x---
CH xxxx|xxxx|xxxx|xxxx`,
  },
  dnb: {
    name: "Drum and Bass",
    description: "Fast breakbeat style pattern",
    bpm: 174,
    pattern: `BD x---|----|x--x|----
SD ----|x---|----|x---
CH x-x-|x-x-|x-x-|x-x-`,
  },
  reggae: {
    name: "Reggae",
    description: "Reggae one-drop rhythm",
    bpm: 80,
    pattern: `BD ----|x---|----|x---
SD ----|x---|----|x---
CH -x-x|-x-x|-x-x|-x-x
RS x---|----|----|----`,
  },
  funk: {
    name: "Funk",
    description: "Syncopated funk groove",
    bpm: 100,
    pattern: `BD x--x|----|x--x|--x-
SD ----|x--x|----|x---
CH x-x-|x-x-|x-x-|x-x-`,
  },
  disco: {
    name: "Disco",
    description: "Classic disco beat",
    bpm: 120,
    pattern: `BD x---|x---|x---|x---
SD ----|x---|----|x---
CH x-x-|x-x-|x-x-|x-x-
OH ----|---x|----|---x`,
  },
  techno: {
    name: "Techno",
    description: "Driving techno beat",
    bpm: 135,
    pattern: `BD x---|x---|x---|x---
CH -x-x|-x-x|-x-x|-x-x
OH ----|----|---x|----
CP ----|x---|----|x---`,
  },
  bossa_nova: {
    name: "Bossa Nova",
    description: "Brazilian bossa nova rhythm",
    bpm: 130,
    pattern: `BD x--x|--x-|x--x|--x-
RS x---|--x-|x---|--x-
CH x-x-|x-x-|x-x-|x-x-`,
  },
};

const DEFAULT_CONFIG = {
  tempDir: join(tmpdir(), "create-drum-tool"),
  sampleCacheDir: join(getCacheDir(), "samples"),
  sampleSource: DRUM_SAMPLES_URL,
  defaultBpm: 120,
  defaultStepsPerBeat: 4,
  ppqn: 480,
  sampleRate: 44100,
};

// ── Helpers ──────────────────────────────────────────────────

function getCacheDir(): string {
  const plat = platform();
  if (plat === "darwin") {
    return join(homedir(), "Library", "Caches", "create-drum-tool");
  } else if (plat === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "create-drum-tool");
  } else {
    return join(homedir(), ".cache", "create-drum-tool");
  }
}

function checkFfmpeg(): boolean {
  try {
    execSync("which ffmpeg", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const file = createWriteStream(destPath);

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadFile(response.headers.location!, destPath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      unlink(destPath).catch(() => {});
      reject(err);
    });
  });
}

function runFfmpeg(args: string[], timeout = 300000): Promise<{ success: boolean }> {
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

function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", filePath]);

    let stdout = "";
    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          const info = JSON.parse(stdout);
          resolve(parseFloat(info.format?.duration || 0));
        } catch {
          resolve(0);
        }
      } else {
        resolve(0);
      }
    });

    proc.on("error", () => resolve(0));
  });
}

// ── State ────────────────────────────────────────────────────

const hasFfmpeg = checkFfmpeg();
const sampleDurations: Record<string, number> = {};

// ── Internal Helpers ─────────────────────────────────────────

async function ensureDirs(): Promise<void> {
  if (!existsSync(DEFAULT_CONFIG.tempDir)) {
    await mkdir(DEFAULT_CONFIG.tempDir, { recursive: true });
  }
  if (!existsSync(DEFAULT_CONFIG.sampleCacheDir)) {
    await mkdir(DEFAULT_CONFIG.sampleCacheDir, { recursive: true });
  }
}

function resolveSample(code: string): SampleInfo | null {
  const upperCode = code.toUpperCase();

  if (SAMPLE_MAP[upperCode]) return SAMPLE_MAP[upperCode];

  for (const [, sample] of Object.entries(SAMPLE_MAP)) {
    if (sample.aliases.some((a) => a.toLowerCase() === code.toLowerCase())) {
      return sample;
    }
  }

  return null;
}

async function getSamplePath(sampleInfo: SampleInfo): Promise<string> {
  if (sampleInfo.bundled) {
    const bundledPath = join(BUNDLED_SAMPLES_DIR, sampleInfo.file);
    if (existsSync(bundledPath)) return bundledPath;
    throw new Error(`Bundled sample not found: ${sampleInfo.file}`);
  }

  await ensureDirs();
  const samplePath = join(DEFAULT_CONFIG.sampleCacheDir, sampleInfo.file);

  if (!existsSync(samplePath)) {
    const url = `${DEFAULT_CONFIG.sampleSource}${sampleInfo.file}`;
    await downloadFile(url, samplePath);
  }

  return samplePath;
}

function parsePattern(patternString: string): ParsedTrack[] {
  const lines = patternString.trim().split("\n");
  const tracks: ParsedTrack[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(\w+)\s+(.+)$/);
    if (!match) continue;

    const [, instrument, patternPart] = match;
    const sample = resolveSample(instrument);

    if (!sample) {
      throw new Error(`Unknown instrument: ${instrument}. Valid: ${Object.keys(SAMPLE_MAP).join(", ")}`);
    }

    const steps: PatternStep[] = [];
    let stepIndex = 0;

    for (const char of patternPart) {
      if (char === "|" || char === " ") continue;

      if (char === "x") {
        steps.push({ step: stepIndex, velocity: 80 });
      } else if (char === "X") {
        steps.push({ step: stepIndex, velocity: 127 });
      } else if (char === "o") {
        steps.push({ step: stepIndex, velocity: 50 });
      }

      stepIndex++;
    }

    if (steps.length > 0 || stepIndex > 0) {
      tracks.push({ sample, steps, totalSteps: stepIndex });
    }
  }

  return tracks;
}

function calculateTiming(tracks: ParsedTrack[], bpm: number, stepsPerBeat = 4): Timing {
  const stepDurationMs = (60 * 1000) / bpm / stepsPerBeat;
  const totalSteps = Math.max(...tracks.map((t) => t.totalSteps));
  const totalDurationMs = totalSteps * stepDurationMs;

  const events: TimingEvent[] = [];

  for (const track of tracks) {
    for (const step of track.steps) {
      events.push({
        sample: track.sample,
        timestampMs: step.step * stepDurationMs,
        velocity: step.velocity,
      });
    }
  }

  events.sort((a, b) => a.timestampMs - b.timestampMs);

  return { events, totalSteps, totalDurationMs, stepDurationMs };
}

async function renderPattern(
  timing: Timing,
  outputPath: string,
  loops = 1
): Promise<{ outputPath: string; totalDurationMs: number }> {
  await ensureDirs();

  const { events, totalDurationMs } = timing;
  if (events.length === 0) throw new Error("Pattern has no hits to render");

  const samplePaths: Record<string, string> = {};
  for (const event of events) {
    const key = event.sample.name;
    if (!samplePaths[key]) {
      samplePaths[key] = await getSamplePath(event.sample);
      if (!sampleDurations[key]) {
        sampleDurations[key] = await getAudioDuration(samplePaths[key]);
      }
    }
  }

  const inputs: string[] = [];
  const filterParts: string[] = [];
  let inputIndex = 0;

  for (const event of events) {
    const samplePath = samplePaths[event.sample.name];
    inputs.push("-i", samplePath);

    const delayMs = Math.round(event.timestampMs);
    const volume = event.velocity / 127;

    filterParts.push(`[${inputIndex}:a]adelay=${delayMs}|${delayMs},volume=${volume}[s${inputIndex}]`);
    inputIndex++;
  }

  const mixInputs = events.map((_, i) => `[s${i}]`).join("");
  filterParts.push(`${mixInputs}amix=inputs=${events.length}:duration=longest:normalize=0[mixed]`);

  const oneIterationPath =
    loops > 1 ? join(DEFAULT_CONFIG.tempDir, `pattern_single_${Date.now()}.wav`) : outputPath;

  const filterComplex = filterParts.join(";");

  await runFfmpeg([
    ...inputs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[mixed]",
    "-ar",
    String(DEFAULT_CONFIG.sampleRate),
    oneIterationPath,
  ]);

  if (loops > 1) {
    const listFile = join(DEFAULT_CONFIG.tempDir, `loop_list_${Date.now()}.txt`);
    const listContent = Array(loops).fill(`file '${oneIterationPath}'`).join("\n");
    await writeFile(listFile, listContent);

    try {
      await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outputPath]);
    } finally {
      await unlink(listFile).catch(() => {});
      await unlink(oneIterationPath).catch(() => {});
    }
  }

  return { outputPath, totalDurationMs: totalDurationMs * loops };
}

function applySwing(timing: Timing, swingPercent: number): Timing {
  if (swingPercent === 0) return timing;

  const swingAmount = (swingPercent / 100) * timing.stepDurationMs;

  for (const event of timing.events) {
    const stepInBeat = Math.floor(event.timestampMs / timing.stepDurationMs) % 4;
    if (stepInBeat % 2 === 1) {
      event.timestampMs += swingAmount;
    }
  }

  timing.events.sort((a, b) => a.timestampMs - b.timestampMs);
  return timing;
}

function applyHumanize(
  timing: Timing,
  timingVariance = 10,
  velocityVariance = 0.1,
  seed: number | null = null
): Timing {
  let rand = seed !== null ? seed : Math.random() * 10000;
  const random = (): number => {
    rand = (rand * 1103515245 + 12345) % 2147483648;
    return rand / 2147483648;
  };

  for (const event of timing.events) {
    const u1 = random();
    const u2 = random();
    const timingJitter = Math.sqrt(-2 * Math.log(u1 + 0.001)) * Math.cos(2 * Math.PI * u2);
    event.timestampMs += timingJitter * timingVariance;
    event.timestampMs = Math.max(0, event.timestampMs);

    const velVariation = 1 + (random() - 0.5) * 2 * velocityVariance;
    event.velocity = Math.round(Math.min(127, Math.max(1, event.velocity * velVariation)));
  }

  return timing;
}

// ── Action Handlers ──────────────────────────────────────────

async function handleRender(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const {
    pattern,
    bpm = DEFAULT_CONFIG.defaultBpm,
    loops = 1,
    swing = 0,
    humanize = false,
    timing_variance = 10,
    velocity_variance = 0.1,
    humanize_seed = null,
    output_format = "wav",
    output_path,
  } = args as {
    pattern?: string;
    bpm?: number;
    loops?: number;
    swing?: number;
    humanize?: boolean;
    timing_variance?: number;
    velocity_variance?: number;
    humanize_seed?: number | null;
    output_format?: string;
    output_path?: string;
  };

  if (!pattern) throw new Error("pattern is required");

  const tracks = parsePattern(pattern);
  if (tracks.length === 0) throw new Error("Pattern has no valid tracks");

  let timing = calculateTiming(tracks, bpm, DEFAULT_CONFIG.defaultStepsPerBeat);
  if (swing > 0) timing = applySwing(timing, swing);
  if (humanize) timing = applyHumanize(timing, timing_variance, velocity_variance, humanize_seed);

  await ensureDirs();
  const ext = output_format.startsWith(".") ? output_format : `.${output_format}`;
  const outPath = output_path
    ? session?.sandboxPath && !output_path.startsWith("/")
      ? resolve(join(session.sandboxPath, output_path))
      : resolve(output_path)
    : join(DEFAULT_CONFIG.tempDir, `pattern_${Date.now()}${ext}`);

  const parentDir = dirname(outPath);
  if (!existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true });
  }

  const result = await renderPattern(timing, outPath, loops);

  return {
    success: true,
    output_path: result.outputPath,
    duration_ms: Math.round(result.totalDurationMs),
    bpm,
    bars: Math.ceil(timing.totalSteps / 16),
    loops,
    swing,
    humanize,
    tracks_count: tracks.length,
    hits_count: timing.events.length,
  };
}

async function handleBuildSong(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { patterns, sequence, crossfade_ms = 0, output_path } = args as {
    patterns?: Record<string, { pattern: string; bpm?: number; swing?: number }>;
    sequence?: string[];
    crossfade_ms?: number;
    output_path?: string;
  };

  if (!patterns || typeof patterns !== "object") throw new Error("patterns object is required");
  if (!sequence || !Array.isArray(sequence) || sequence.length === 0) throw new Error("sequence array is required");

  await ensureDirs();

  const renderedPatterns: Record<string, string> = {};
  for (const [name, config] of Object.entries(patterns)) {
    const patternPath = join(DEFAULT_CONFIG.tempDir, `song_pattern_${name}_${Date.now()}.wav`);
    const tracks = parsePattern(config.pattern);
    const timing = calculateTiming(tracks, config.bpm || DEFAULT_CONFIG.defaultBpm);

    if (config.swing) applySwing(timing, config.swing);

    await renderPattern(timing, patternPath, 1);
    renderedPatterns[name] = patternPath;
  }

  const patternFiles = sequence.map((name) => {
    if (!renderedPatterns[name]) throw new Error(`Pattern "${name}" not found in patterns object`);
    return renderedPatterns[name];
  });

  const outPath = output_path
    ? session?.sandboxPath && !output_path.startsWith("/")
      ? resolve(join(session.sandboxPath, output_path))
      : resolve(output_path)
    : join(DEFAULT_CONFIG.tempDir, `song_${Date.now()}.wav`);

  const outParentDir = dirname(outPath);
  if (!existsSync(outParentDir)) {
    await mkdir(outParentDir, { recursive: true });
  }

  if (crossfade_ms > 0 && patternFiles.length > 1) {
    const crossfadeSec = crossfade_ms / 1000;
    let filterComplex = "";
    let currentInput = "[0:a]";

    for (let i = 1; i < patternFiles.length; i++) {
      const nextInput = `[${i}:a]`;
      const outputLabel = i === patternFiles.length - 1 ? "" : `[a${i}]`;
      filterComplex += `${currentInput}${nextInput}acrossfade=d=${crossfadeSec}:c1=tri:c2=tri${outputLabel};`;
      currentInput = `[a${i}]`;
    }
    filterComplex = filterComplex.slice(0, -1);

    const ffmpegArgs = patternFiles.flatMap((f) => ["-i", f]);
    ffmpegArgs.push("-filter_complex", filterComplex, outPath);
    await runFfmpeg(ffmpegArgs);
  } else {
    const listFile = join(DEFAULT_CONFIG.tempDir, `song_list_${Date.now()}.txt`);
    const listContent = patternFiles.map((f) => `file '${f}'`).join("\n");
    await writeFile(listFile, listContent);

    try {
      await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outPath]);
    } finally {
      await unlink(listFile).catch(() => {});
    }
  }

  for (const path of Object.values(renderedPatterns)) {
    await unlink(path).catch(() => {});
  }

  const duration = await getAudioDuration(outPath);

  return {
    success: true,
    output_path: outPath,
    duration_ms: Math.round(duration * 1000),
    patterns_count: Object.keys(patterns).length,
    sequence_length: sequence.length,
    crossfade_ms,
  };
}

function handleListSamples(): unknown {
  const samples = Object.entries(SAMPLE_MAP).map(([code, sample]) => ({
    code,
    name: sample.name,
    category: sample.category,
    aliases: sample.aliases,
  }));

  const categories = [...new Set(samples.map((s) => s.category))];

  return { success: true, samples, categories, total_count: samples.length };
}

function handleListPresets(): unknown {
  const presets = Object.entries(PRESET_PATTERNS).map(([key, preset]) => ({
    key,
    name: preset.name,
    description: preset.description,
    bpm: preset.bpm,
  }));

  return { success: true, presets, total_count: presets.length };
}

function handleGetPreset(args: Record<string, unknown>): unknown {
  const { preset_name } = args as { preset_name?: string };
  if (!preset_name) throw new Error("preset_name is required");

  const preset = PRESET_PATTERNS[preset_name.toLowerCase()];
  if (!preset) {
    throw new Error(`Preset not found: ${preset_name}. Use list_presets to see available presets.`);
  }

  return {
    success: true,
    preset: {
      key: preset_name.toLowerCase(),
      name: preset.name,
      description: preset.description,
      bpm: preset.bpm,
      pattern: preset.pattern,
    },
  };
}

async function handleRenderPreset(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const { preset_name, bpm, loops, swing, humanize, output_path } = args as {
    preset_name?: string;
    bpm?: number;
    loops?: number;
    swing?: number;
    humanize?: boolean;
    output_path?: string;
  };

  const presetResult = handleGetPreset({ preset_name }) as { preset: { pattern: string; bpm: number } };
  const preset = presetResult.preset;

  return handleRender(
    {
      pattern: preset.pattern,
      bpm: bpm || preset.bpm,
      loops,
      swing,
      humanize,
      output_path,
    },
    session
  );
}

function handleCheckBackends(): unknown {
  let samplesReady = false;
  try {
    const samplePath = join(BUNDLED_SAMPLES_DIR, "bd.mp3");
    samplesReady = existsSync(samplePath);
  } catch {}

  return {
    success: true,
    ffmpeg_available: hasFfmpeg,
    samples_bundled: samplesReady,
    bundled_samples_dir: BUNDLED_SAMPLES_DIR,
    ready: hasFfmpeg && samplesReady,
    presets_available: Object.keys(PRESET_PATTERNS).length,
    samples_available: Object.keys(SAMPLE_MAP).length,
  };
}

async function handleDownloadSamples(): Promise<unknown> {
  const available: string[] = [];
  const missing: Array<{ code: string; error: string }> = [];

  for (const [code, sample] of Object.entries(SAMPLE_MAP)) {
    try {
      await getSamplePath(sample);
      available.push(code);
    } catch (err: any) {
      missing.push({ code, error: err.message });
    }
  }

  return {
    success: missing.length === 0,
    available_count: available.length,
    missing_count: missing.length,
    available,
    missing,
    bundled_dir: BUNDLED_SAMPLES_DIR,
  };
}

// ── Main Execute ─────────────────────────────────────────────

async function executeMain(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
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
      case "render": result = await handleRender(args, session); break;
      case "build_song": result = await handleBuildSong(args, session); break;
      case "list_samples": result = handleListSamples(); break;
      case "list_presets": result = handleListPresets(); break;
      case "get_preset": result = handleGetPreset(args); break;
      case "render_preset": result = await handleRenderPreset(args, session); break;
      case "download_samples": result = await handleDownloadSamples(); break;
      case "check_backends": result = handleCheckBackends(); break;
      default:
        return formatError(
          `Unknown action: ${action}. Valid actions: render, build_song, list_samples, list_presets, get_preset, render_preset, download_samples, check_backends`
        );
    }
    return formatResponse(result);
  } catch (err: any) {
    return formatError(err.message);
  }
}

async function executeMakeBeat(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { preset, pattern, bpm, loops, output_path } = args as {
    preset?: string;
    pattern?: string;
    bpm?: number;
    loops?: number;
    output_path?: string;
  };

  if (preset) {
    return executeMain(
      { action: "render_preset", preset_name: preset, bpm, loops, output_path },
      ctx
    );
  }
  return executeMain(
    { action: "render", pattern, bpm, loops, output_path },
    ctx
  );
}

// ── Input Schemas ────────────────────────────────────────────

const mainInputSchema = {
  type: "object" as const,
  properties: {
    action: {
      type: "string",
      enum: ["render", "build_song", "list_samples", "list_presets", "get_preset", "render_preset", "download_samples", "check_backends"],
      description: "Action to perform",
    },
    pattern: {
      type: "string",
      description:
        'Pattern notation: "BD x---x---|x---x---\\nSD ----|x---|----|x---" where x=hit, X=accent, o=soft, -=rest, |=bar separator',
    },
    bpm: { type: "number", description: "Tempo in BPM (default: 120)" },
    loops: { type: "number", description: "Number of times to repeat the pattern (default: 1)" },
    swing: { type: "number", description: "Swing percentage 0-100 (default: 0)" },
    humanize: { type: "boolean", description: "Add timing and velocity variation for natural feel (default: false)" },
    timing_variance: { type: "number", description: "Timing jitter in ms for humanize (default: 10)" },
    velocity_variance: { type: "number", description: "Velocity variation 0-1 for humanize (default: 0.1)" },
    output_format: { type: "string", description: "Output format: wav, mp3 (default: wav)" },
    output_path: { type: "string", description: "Path for output file (auto-generated if not provided)" },
    preset_name: { type: "string", description: "Name of preset pattern (for get_preset/render_preset actions)" },
    patterns: { type: "object", description: "Object of named patterns for build_song action" },
    sequence: { type: "array", items: { type: "string" }, description: "Array of pattern names for build_song arrangement" },
    crossfade_ms: { type: "number", description: "Crossfade duration between patterns in ms (for build_song)" },
  },
  required: ["action"],
};

// ── Tool Definitions ─────────────────────────────────────────

const createDrumTool: Tool = {
  name: "create_drum",
  description: "Create TR-808 style drum patterns and render to audio using ffmpeg",
  needsSandbox: true,
  inputSchema: mainInputSchema,
  execute: executeMain,
};

const drumMachineTool: Tool = {
  name: "drum_machine",
  description: "Alias for create_drum - TR-808 style drum pattern generator",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "Action to perform" },
      pattern: { type: "string", description: "Drum pattern notation" },
      bpm: { type: "number", description: "Tempo in BPM" },
    },
    required: ["action"],
  },
  execute: executeMain,
};

const makeBeatTool: Tool = {
  name: "make_beat",
  description: "Quick drum beat generator - provide pattern or preset name",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Drum pattern notation" },
      preset: { type: "string", description: "Preset name (e.g., boom_bap, trap, four_on_floor)" },
      bpm: { type: "number", description: "Tempo in BPM" },
      loops: { type: "number", description: "Number of repetitions" },
      output_path: { type: "string", description: "Output file path" },
    },
  },
  execute: executeMakeBeat,
};

export default [createDrumTool, drumMachineTool, makeBeatTool];
