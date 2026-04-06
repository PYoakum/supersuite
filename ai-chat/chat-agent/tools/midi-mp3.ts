import { spawn, execSync } from "child_process";
import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { existsSync, createWriteStream, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { tmpdir, homedir, platform } from "os";
import https from "https";
import http from "http";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ────────────────────────────────────────────────

const SOUNDFONT_URL = "./MuseScore_General.sf2";

const NOTE_MAP: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const DURATION_MAP: Record<string, number> = {
  w: 1920,
  h: 960,
  q: 480,
  e: 240,
  s: 120,
  t: 60,
};

const GM_INSTRUMENTS = [
  "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano",
  "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet",
  "Celesta", "Glockenspiel", "Music Box", "Vibraphone",
  "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
  "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ",
  "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
  "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)",
  "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics",
  "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass",
  "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
  "Violin", "Viola", "Cello", "Contrabass",
  "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
  "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2",
  "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
  "Trumpet", "Trombone", "Tuba", "Muted Trumpet",
  "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
  "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax",
  "Oboe", "English Horn", "Bassoon", "Clarinet",
  "Piccolo", "Flute", "Recorder", "Pan Flute",
  "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
  "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)",
  "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)",
  "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)",
  "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
  "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)",
  "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
  "Sitar", "Banjo", "Shamisen", "Koto",
  "Kalimba", "Bagpipe", "Fiddle", "Shanai",
  "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock",
  "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
  "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet",
  "Telephone Ring", "Helicopter", "Applause", "Gunshot",
];

const INSTRUMENT_ALIASES: Record<string, number> = {
  piano: 0, grand: 0, acoustic_piano: 0,
  epiano: 4, electric_piano: 4, rhodes: 4,
  organ: 19, church_organ: 19,
  guitar: 25, acoustic_guitar: 24, nylon_guitar: 24, steel_guitar: 25,
  electric_guitar: 27, distortion: 30, overdrive: 29,
  bass: 33, electric_bass: 33, acoustic_bass: 32, fretless: 35,
  violin: 40, viola: 41, cello: 42, contrabass: 43,
  strings: 48, orchestra: 48,
  choir: 52, voice: 54,
  trumpet: 56, trombone: 57, tuba: 58, french_horn: 60,
  brass: 61,
  sax: 65, alto_sax: 65, tenor_sax: 66, soprano_sax: 64,
  oboe: 68, clarinet: 71, flute: 73, piccolo: 72,
  synth: 80, lead: 80, pad: 88,
};

const DEFAULT_CONFIG = {
  tempDir: join(tmpdir(), "midi-mp3-tool"),
  soundfontDir: getSoundfontDir(),
  defaultSoundfont: "MuseScore_General.sf2",
  soundfontUrl: SOUNDFONT_URL,
  defaultBpm: 120,
  ppqn: 480,
  sampleRate: 44100,
  defaultInstrument: 0,
  defaultVelocity: 80,
  mp3Bitrate: "192k",
};

// ── Types ────────────────────────────────────────────────────

interface ParsedNote {
  pitch: number;
  startTick: number;
  duration: number;
  velocity: number;
}

interface ParsedInput {
  notes: ParsedNote[];
  tempo: number;
  totalTicks: number;
}

interface Session {
  sandboxPath?: string;
  id?: string;
  sessionId?: string;
}

// ── Helpers ──────────────────────────────────────────────────

function getSoundfontDir(): string {
  const plat = platform();
  if (plat === "darwin") {
    return join(homedir(), "Library", "Sounds", "Banks");
  } else if (plat === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "midi-mp3", "soundfonts");
  } else {
    const locations = [
      "/usr/share/sounds/sf2",
      "/usr/share/soundfonts",
      join(homedir(), ".local", "share", "soundfonts"),
    ];
    for (const loc of locations) {
      if (existsSync(loc)) return loc;
    }
    return join(homedir(), ".local", "share", "soundfonts");
  }
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
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

function runCommandProc(
  cmd: string,
  args: string[],
  timeout = 300000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
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

function parseNote(noteStr: string): number | null {
  const match = noteStr.match(/^([A-Ga-g])([#b]?)(\d)$/);
  if (!match) return null;

  const [, noteName, accidental, octave] = match;
  let midiNum = NOTE_MAP[noteName.toUpperCase()];

  if (accidental === "#") midiNum += 1;
  else if (accidental === "b") midiNum -= 1;

  midiNum += (parseInt(octave) + 1) * 12;

  return Math.max(0, Math.min(127, midiNum));
}

function parseDuration(durStr: string, ppqn = 480): number {
  const str = durStr.toLowerCase();
  const dotted = str.endsWith(".");
  const base = dotted ? str.slice(0, -1) : str;

  let ticks = DURATION_MAP[base];
  if (!ticks) {
    const num = parseFloat(base);
    if (!isNaN(num)) {
      ticks = Math.round(num * ppqn);
    } else {
      ticks = ppqn;
    }
  }

  if (dotted) ticks = Math.round(ticks * 1.5);

  return ticks;
}

// ── State ────────────────────────────────────────────────────

const hasFluidsynth = commandExists("fluidsynth");
const hasFfmpeg = commandExists("ffmpeg");
const hasLame = commandExists("lame");

// ── LLM Client Interface ────────────────────────────────────

let llmClient: {
  send: (opts: {
    systemPrompt: string;
    userPrompt: string;
    sessionId?: string;
    operation?: string;
    parameters?: { temperature?: number; maxTokens?: number };
  }) => Promise<{ content: string }>;
} | null = null;

function setLLMClient(client: typeof llmClient): void {
  llmClient = client;
}

// ── Internal Helpers ─────────────────────────────────────────

async function ensureDirs(): Promise<void> {
  if (!existsSync(DEFAULT_CONFIG.tempDir)) {
    await mkdir(DEFAULT_CONFIG.tempDir, { recursive: true });
  }
  if (!existsSync(DEFAULT_CONFIG.soundfontDir)) {
    await mkdir(DEFAULT_CONFIG.soundfontDir, { recursive: true });
  }
}

async function getSoundfontPath(name: string | null = null): Promise<string> {
  await ensureDirs();
  const sfName = name || DEFAULT_CONFIG.defaultSoundfont;

  const locations = [
    join(DEFAULT_CONFIG.soundfontDir, sfName),
    `/usr/share/sounds/sf2/${sfName}`,
    `/usr/share/soundfonts/${sfName}`,
  ];

  for (const loc of locations) {
    if (existsSync(loc)) return loc;
  }

  if (!name || name === DEFAULT_CONFIG.defaultSoundfont) {
    const destPath = join(DEFAULT_CONFIG.soundfontDir, DEFAULT_CONFIG.defaultSoundfont);
    await downloadFile(DEFAULT_CONFIG.soundfontUrl, destPath);
    return destPath;
  }

  throw new Error(`Soundfont not found: ${sfName}`);
}

function resolveInstrument(instrument: number | string): number {
  if (typeof instrument === "number") {
    return Math.max(0, Math.min(127, instrument));
  }

  const name = instrument.toLowerCase().replace(/\s+/g, "_");
  if (INSTRUMENT_ALIASES[name] !== undefined) return INSTRUMENT_ALIASES[name];

  const index = GM_INSTRUMENTS.findIndex(
    (n) => n.toLowerCase().replace(/\s+/g, "_").includes(name)
  );
  if (index >= 0) return index;

  return DEFAULT_CONFIG.defaultInstrument;
}

async function extractNotesWithLLM(input: string, sessionId?: string): Promise<string> {
  if (!llmClient) return input;

  const trimmed = input.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return input;

  const noteTokenPattern = /^(tempo:\d+\s*)?(\[?[A-Ga-gRr][#b]?\d?(\s+[A-Ga-g][#b]?\d)?\]?:[whqest]\.?(\:\d+)?\s*|\|\s*)+$/;
  if (noteTokenPattern.test(trimmed)) return input;

  const systemPrompt = `task:
  role: MIDI Note Generator
  objective: Convert input to MIDI note notation string
  output_constraint: OUTPUT ONLY THE NOTE STRING - NO OTHER TEXT

output_format:
  type: raw_string
  content: MIDI notes only
  forbidden:
    - explanations
    - markdown
    - code blocks
    - prose
    - comments
    - prefixes like "Output:" or "Notes:"

note_syntax:
  pattern: "NOTE:DURATION"
  note_format:
    letter: A-G (uppercase)
    accidental: "#" (sharp) or "b" (flat), optional
    octave: 0-8 (middle C = C4)
  duration_codes:
    w: whole note
    h: half note
    q: quarter note
    e: eighth note
    s: sixteenth note
    ".": dotted (append to duration)
  special:
    rest: "R:duration" (e.g., R:q)
    chord: "[C4 E4 G4]:duration"
    tempo: "tempo:BPM" at start
    bar: "|" as separator

examples:
  - input: "Happy Birthday melody"
    output: "C4:q C4:e D4:q C4:q F4:q E4:h | C4:q C4:e D4:q C4:q G4:q F4:h"
  - input: "C major scale"
    output: "C4:q D4:q E4:q F4:q G4:q A4:q B4:q C5:q"
  - input: "C major chord"
    output: "[C4 E4 G4]:h"
  - input: "tempo:90 C4:q E4:q G4:q"
    output: "tempo:90 C4:q E4:q G4:q"

fallback:
  condition: cannot determine notes
  output: "[C4 E4 G4]:h"

CRITICAL: Your entire response must be ONLY the note string. Do not write anything else.`;

  const userPrompt = `Convert to MIDI notes:\n${input}\n\nOUTPUT ONLY NOTES:`;

  try {
    const response = await llmClient.send({
      systemPrompt,
      userPrompt,
      sessionId,
      operation: "midi_note_extraction",
      parameters: { temperature: 0.3, maxTokens: 1024 },
    });

    const cleaned = response.content
      .trim()
      .replace(/^```[\w]*\n?/gm, "")
      .replace(/\n?```$/gm, "")
      .trim();

    return cleaned || input;
  } catch (err: any) {
    console.error("MIDI note extraction failed, using raw input:", err.message);
    return input;
  }
}

function parseNoteDsl(input: string): ParsedInput {
  const lines = input.trim().split("\n");
  const notes: ParsedNote[] = [];
  let tempo = DEFAULT_CONFIG.defaultBpm;
  let currentTick = 0;

  for (const line of lines) {
    const tokens = line.trim().match(/\[[^\]]+\]:\w+\.?|\S+/g) || [];

    for (const token of tokens) {
      if (!token || token === "|") continue;

      if (token.startsWith("tempo:")) {
        tempo = parseInt(token.split(":")[1]) || DEFAULT_CONFIG.defaultBpm;
        continue;
      }

      if (token.startsWith("R:") || token.startsWith("r:")) {
        const duration = parseDuration(token.split(":")[1], DEFAULT_CONFIG.ppqn);
        currentTick += duration;
        continue;
      }

      if (token.startsWith("[")) {
        const match = token.match(/\[([^\]]+)\]:(\w+\.?)/);
        if (match) {
          const chordNotes = match[1].split(/\s+/);
          const duration = parseDuration(match[2], DEFAULT_CONFIG.ppqn);

          for (const noteStr of chordNotes) {
            const pitch = parseNote(noteStr);
            if (pitch !== null) {
              notes.push({ pitch, startTick: currentTick, duration, velocity: DEFAULT_CONFIG.defaultVelocity });
            }
          }
          currentTick += duration;
        }
        continue;
      }

      const parts = token.split(":");
      if (parts.length >= 2) {
        const pitch = parseNote(parts[0]);
        if (pitch !== null) {
          const duration = parseDuration(parts[1], DEFAULT_CONFIG.ppqn);
          const velocity = parts[2] ? parseInt(parts[2]) : DEFAULT_CONFIG.defaultVelocity;
          notes.push({ pitch, startTick: currentTick, duration, velocity: Math.max(1, Math.min(127, velocity)) });
          currentTick += duration;
        }
      }
    }
  }

  return { notes, tempo, totalTicks: currentTick };
}

function parseJsonFormat(input: string | Record<string, unknown>): ParsedInput {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  const tempo = (data as any).tempo || DEFAULT_CONFIG.defaultBpm;
  const notes: ParsedNote[] = [];
  let currentTick = 0;

  for (const note of ((data as any).notes || [])) {
    const pitch = typeof note.pitch === "number" ? note.pitch : parseNote(note.pitch);
    const duration = parseDuration(note.duration || "q", DEFAULT_CONFIG.ppqn);
    const velocity = note.velocity || DEFAULT_CONFIG.defaultVelocity;

    if (pitch !== null) {
      const startTick = note.start_tick !== undefined ? note.start_tick : currentTick;
      notes.push({ pitch, startTick, duration, velocity: Math.max(1, Math.min(127, velocity)) });
      if (note.start_tick === undefined) currentTick += duration;
    }
  }

  const totalTicks = Math.max(currentTick, ...notes.map((n) => n.startTick + n.duration));
  return { notes, tempo, totalTicks };
}

function parseInput(input: string): ParsedInput {
  const trimmed = input.trim();

  if (trimmed.startsWith("{")) return parseJsonFormat(trimmed);

  if (trimmed.startsWith("[")) {
    if (/^\[[A-Ga-g][#b]?\d/.test(trimmed)) return parseNoteDsl(trimmed);
    try {
      return parseJsonFormat(trimmed);
    } catch {
      return parseNoteDsl(trimmed);
    }
  }

  if (trimmed.includes("X:") || trimmed.includes("K:")) {
    throw new Error('ABC notation not yet supported. Use note DSL format: "C4:q D4:q E4:h"');
  }

  return parseNoteDsl(trimmed);
}

function generateMidi(parsed: ParsedInput, instrument = 0): Buffer {
  const { notes, tempo } = parsed;
  const ppqn = DEFAULT_CONFIG.ppqn;

  const chunks: Buffer[] = [];

  const headerChunk = Buffer.alloc(14);
  headerChunk.write("MThd", 0);
  headerChunk.writeUInt32BE(6, 4);
  headerChunk.writeUInt16BE(0, 8);
  headerChunk.writeUInt16BE(1, 10);
  headerChunk.writeUInt16BE(ppqn, 12);
  chunks.push(headerChunk);

  interface TrackEvent {
    deltaTicks: number;
    bytes: Buffer;
  }

  const trackEvents: TrackEvent[] = [];

  const microsecondsPerBeat = Math.round(60000000 / tempo);
  trackEvents.push({
    deltaTicks: 0,
    bytes: Buffer.from([
      0xff, 0x51, 0x03,
      (microsecondsPerBeat >> 16) & 0xff,
      (microsecondsPerBeat >> 8) & 0xff,
      microsecondsPerBeat & 0xff,
    ]),
  });

  trackEvents.push({
    deltaTicks: 0,
    bytes: Buffer.from([0xc0, instrument & 0x7f]),
  });

  const sortedNotes = [...notes].sort((a, b) => a.startTick - b.startTick);

  interface NoteEvent {
    tick: number;
    type: "on" | "off";
    pitch: number;
    velocity: number;
  }

  const noteEvents: NoteEvent[] = [];
  for (const note of sortedNotes) {
    noteEvents.push({ tick: note.startTick, type: "on", pitch: note.pitch, velocity: note.velocity });
    noteEvents.push({ tick: note.startTick + note.duration, type: "off", pitch: note.pitch, velocity: 0 });
  }

  noteEvents.sort((a, b) => a.tick - b.tick || (a.type === "off" ? -1 : 1));

  let lastTick = 0;
  for (const event of noteEvents) {
    const deltaTicks = event.tick - lastTick;
    lastTick = event.tick;

    const status = event.type === "on" ? 0x90 : 0x80;
    trackEvents.push({
      deltaTicks,
      bytes: Buffer.from([status, event.pitch & 0x7f, event.velocity & 0x7f]),
    });
  }

  trackEvents.push({ deltaTicks: 0, bytes: Buffer.from([0xff, 0x2f, 0x00]) });

  function encodeVlq(value: number): Buffer {
    const bytes: number[] = [];
    bytes.push(value & 0x7f);
    value >>= 7;
    while (value > 0) {
      bytes.unshift((value & 0x7f) | 0x80);
      value >>= 7;
    }
    return Buffer.from(bytes);
  }

  const trackData: Buffer[] = [];
  for (const event of trackEvents) {
    trackData.push(encodeVlq(event.deltaTicks));
    trackData.push(event.bytes);
  }
  const trackBuffer = Buffer.concat(trackData);

  const trackHeader = Buffer.alloc(8);
  trackHeader.write("MTrk", 0);
  trackHeader.writeUInt32BE(trackBuffer.length, 4);
  chunks.push(trackHeader);
  chunks.push(trackBuffer);

  return Buffer.concat(chunks);
}

async function synthesize(midiPath: string, wavPath: string, soundfontPath: string): Promise<void> {
  await runCommandProc("fluidsynth", [
    "-ni",
    "-F", wavPath,
    "-r", String(DEFAULT_CONFIG.sampleRate),
    soundfontPath,
    midiPath,
  ]);
}

async function encodeToMp3(wavPath: string, mp3Path: string): Promise<void> {
  if (hasLame) {
    await runCommandProc("lame", ["-b", DEFAULT_CONFIG.mp3Bitrate.replace("k", ""), wavPath, mp3Path]);
  } else if (hasFfmpeg) {
    await runCommandProc("ffmpeg", ["-y", "-i", wavPath, "-b:a", DEFAULT_CONFIG.mp3Bitrate, mp3Path]);
  } else {
    throw new Error("No MP3 encoder available. Install lame or ffmpeg.");
  }
}

function getInstrumentFamily(num: number): string {
  if (num < 8) return "Piano";
  if (num < 16) return "Chromatic Percussion";
  if (num < 24) return "Organ";
  if (num < 32) return "Guitar";
  if (num < 40) return "Bass";
  if (num < 48) return "Strings";
  if (num < 56) return "Ensemble";
  if (num < 64) return "Brass";
  if (num < 72) return "Reed";
  if (num < 80) return "Pipe";
  if (num < 88) return "Synth Lead";
  if (num < 96) return "Synth Pad";
  if (num < 104) return "Synth Effects";
  if (num < 112) return "Ethnic";
  if (num < 120) return "Percussive";
  return "Sound Effects";
}

// ── Action Handlers ──────────────────────────────────────────

async function handleSynthesize(args: Record<string, unknown>, session: Session | null): Promise<unknown> {
  const {
    input_text,
    tempo,
    instrument = 0,
    soundfont,
    output_format = "mp3",
    output_path,
    keep_midi = false,
    llm_preprocess = true,
  } = args as {
    input_text?: string;
    tempo?: number;
    instrument?: number | string;
    soundfont?: string;
    output_format?: string;
    output_path?: string;
    keep_midi?: boolean;
    llm_preprocess?: boolean;
  };

  if (!input_text) throw new Error("input_text is required");
  if (!hasFluidsynth) {
    throw new Error("FluidSynth is not installed. Install with: brew install fluid-synth (macOS) or apt-get install fluidsynth (Linux)");
  }

  const sessionId = session?.id || session?.sessionId;
  let cleanedInput = input_text;
  let wasPreprocessed = false;

  if (llm_preprocess && llmClient) {
    cleanedInput = await extractNotesWithLLM(input_text, sessionId);
    wasPreprocessed = cleanedInput !== input_text;
  }

  const parsed = parseInput(cleanedInput);
  if (tempo) parsed.tempo = tempo;

  if (parsed.notes.length === 0) throw new Error("No valid notes found in input");

  const instrumentNum = resolveInstrument(instrument);
  const midiBuffer = generateMidi(parsed, instrumentNum);

  await ensureDirs();

  const midiPath = join(DEFAULT_CONFIG.tempDir, `synth_${Date.now()}.mid`);
  await writeFile(midiPath, midiBuffer);

  const sfPath = await getSoundfontPath(soundfont || null);

  const wavPath = join(DEFAULT_CONFIG.tempDir, `synth_${Date.now()}.wav`);
  await synthesize(midiPath, wavPath, sfPath);

  const ext =
    output_format.toLowerCase() === "wav" ? ".wav"
    : output_format.toLowerCase() === "midi" || output_format.toLowerCase() === "mid" ? ".mid"
    : ".mp3";

  let finalPath: string;
  if (output_path) {
    finalPath = session?.sandboxPath && !output_path.startsWith("/")
      ? resolve(join(session.sandboxPath, output_path))
      : resolve(output_path);
  } else {
    finalPath = join(DEFAULT_CONFIG.tempDir, `output_${Date.now()}${ext}`);
  }

  const parentDir = dirname(finalPath);
  if (!existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true });
  }

  if (ext === ".mid") {
    await writeFile(finalPath, midiBuffer);
  } else if (ext === ".mp3") {
    await encodeToMp3(wavPath, finalPath);
  } else {
    await writeFile(finalPath, await readFile(wavPath));
  }

  const durationMs = Math.round((parsed.totalTicks / DEFAULT_CONFIG.ppqn) * (60000 / parsed.tempo));

  await unlink(wavPath).catch(() => {});
  if (!keep_midi) await unlink(midiPath).catch(() => {});

  return {
    success: true,
    output_path: finalPath,
    midi_path: keep_midi ? midiPath : undefined,
    duration_ms: durationMs,
    notes_count: parsed.notes.length,
    tempo: parsed.tempo,
    instrument: GM_INSTRUMENTS[instrumentNum] || `Program ${instrumentNum}`,
    format: ext.slice(1),
    preprocessed: wasPreprocessed,
    notes_used: cleanedInput,
  };
}

function handleValidateInput(args: Record<string, unknown>): unknown {
  const { input_text } = args as { input_text?: string };
  if (!input_text) throw new Error("input_text is required");

  try {
    const parsed = parseInput(input_text);
    return {
      success: true,
      valid: true,
      notes_count: parsed.notes.length,
      tempo: parsed.tempo,
      total_ticks: parsed.totalTicks,
      duration_ms: Math.round((parsed.totalTicks / DEFAULT_CONFIG.ppqn) * (60000 / parsed.tempo)),
    };
  } catch (err: any) {
    return { success: true, valid: false, error: err.message };
  }
}

function handleListInstruments(): unknown {
  const instruments = GM_INSTRUMENTS.map((name, index) => ({
    number: index,
    name,
    family: getInstrumentFamily(index),
  }));

  const families = [
    { range: "0-7", name: "Piano" },
    { range: "8-15", name: "Chromatic Percussion" },
    { range: "16-23", name: "Organ" },
    { range: "24-31", name: "Guitar" },
    { range: "32-39", name: "Bass" },
    { range: "40-47", name: "Strings" },
    { range: "48-55", name: "Ensemble" },
    { range: "56-63", name: "Brass" },
    { range: "64-71", name: "Reed" },
    { range: "72-79", name: "Pipe" },
    { range: "80-87", name: "Synth Lead" },
    { range: "88-95", name: "Synth Pad" },
    { range: "96-103", name: "Synth Effects" },
    { range: "104-111", name: "Ethnic" },
    { range: "112-119", name: "Percussive" },
    { range: "120-127", name: "Sound Effects" },
  ];

  return { success: true, instruments, families, total_count: 128 };
}

async function handleListSoundfonts(): Promise<unknown> {
  await ensureDirs();

  const soundfonts: Array<{ name: string; path: string; is_default: boolean }> = [];

  const defaultPath = join(DEFAULT_CONFIG.soundfontDir, DEFAULT_CONFIG.defaultSoundfont);
  if (existsSync(defaultPath)) {
    soundfonts.push({ name: DEFAULT_CONFIG.defaultSoundfont, path: defaultPath, is_default: true });
  }

  const systemPaths = ["/usr/share/sounds/sf2", "/usr/share/soundfonts"];
  for (const dir of systemPaths) {
    if (existsSync(dir)) {
      try {
        const files = readdirSync(dir);
        for (const file of files) {
          if (file.endsWith(".sf2")) {
            soundfonts.push({ name: file, path: join(dir, file), is_default: false });
          }
        }
      } catch {}
    }
  }

  return {
    success: true,
    soundfonts,
    default_soundfont: DEFAULT_CONFIG.defaultSoundfont,
    soundfont_dir: DEFAULT_CONFIG.soundfontDir,
  };
}

async function handleDownloadSoundfont(args: Record<string, unknown>): Promise<unknown> {
  const { url, name } = args as { url?: string; name?: string };

  await ensureDirs();

  const sfUrl = url || DEFAULT_CONFIG.soundfontUrl;
  const sfName = name || DEFAULT_CONFIG.defaultSoundfont;
  const destPath = join(DEFAULT_CONFIG.soundfontDir, sfName);

  if (existsSync(destPath)) {
    return { success: true, message: "Soundfont already exists", path: destPath };
  }

  await downloadFile(sfUrl, destPath);

  return { success: true, message: "Soundfont downloaded successfully", path: destPath, name: sfName };
}

function handleCheckBackends(): unknown {
  return {
    success: true,
    fluidsynth_available: hasFluidsynth,
    ffmpeg_available: hasFfmpeg,
    lame_available: hasLame,
    mp3_encoder: hasLame ? "lame" : hasFfmpeg ? "ffmpeg" : null,
    ready: hasFluidsynth,
    soundfont_dir: DEFAULT_CONFIG.soundfontDir,
    temp_dir: DEFAULT_CONFIG.tempDir,
  };
}

// ── Main Execute ─────────────────────────────────────────────

async function executeMain(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { action } = args as { action?: string };
  const session: Session | null = args.sessionId
    ? { sandboxPath: await ctx.sandbox.ensureSandbox(args.sessionId as string), sessionId: args.sessionId as string }
    : null;

  try {
    let result: unknown;
    switch (action) {
      case "synthesize": result = await handleSynthesize(args, session); break;
      case "validate_input": result = handleValidateInput(args); break;
      case "list_instruments": result = handleListInstruments(); break;
      case "list_soundfonts": result = await handleListSoundfonts(); break;
      case "download_soundfont": result = await handleDownloadSoundfont(args); break;
      case "check_backends": result = handleCheckBackends(); break;
      default:
        return formatError(
          `Unknown action: ${action}. Valid actions: synthesize, validate_input, list_instruments, list_soundfonts, download_soundfont, check_backends`
        );
    }
    return formatResponse(result);
  } catch (err: any) {
    return formatError(err.message);
  }
}

async function executeMakeMusic(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const { notes, tempo, instrument, format, output_path, llm_preprocess } = args as {
    notes?: string;
    tempo?: number;
    instrument?: number | string;
    format?: string;
    output_path?: string;
    llm_preprocess?: boolean;
  };

  return executeMain(
    {
      action: "synthesize",
      input_text: notes,
      tempo,
      instrument,
      output_format: format,
      output_path,
      llm_preprocess,
      sessionId: args.sessionId,
    },
    ctx
  );
}

// ── Note Format Description ──────────────────────────────────

const noteFormatDescription = `MIDI note notation string. IMPORTANT: Provide ONLY notes in this exact format, no prose or explanations.

FORMAT: Each note is "NOTE:DURATION" separated by spaces.
- NOTE: Letter (A-G) + optional accidental (# or b) + octave number (0-8). Middle C = C4.
- DURATION: w=whole, h=half, q=quarter, e=eighth, s=sixteenth. Add "." for dotted notes.
- RESTS: Use "R:duration" (e.g., R:q for quarter rest)
- CHORDS: Use brackets "[C4 E4 G4]:q" for simultaneous notes
- TEMPO: Optionally start with "tempo:120" to set BPM
- BARS: Use "|" as optional visual separator

EXAMPLES:
- Simple melody: "C4:q D4:q E4:q F4:q G4:h"
- With tempo: "tempo:90 C4:q E4:q G4:q C5:h"
- With rests: "C4:q R:q D4:q R:q E4:h"
- Chords: "[C4 E4 G4]:h [F4 A4 C5]:h [G4 B4 D5]:w"
- Dotted notes: "C4:q. D4:e E4:h."

OUTPUT ONLY THE NOTE STRING. Do not include any other text, explanation, or markdown.`;

// ── Tool Definitions ─────────────────────────────────────────

const midiMp3Tool: Tool = {
  name: "midi_mp3",
  description:
    "CREATE AUDIO FILES from note notation. This tool synthesizes notes into actual MP3/WAV audio files using FluidSynth. Use action=\"synthesize\" to generate audio. Returns the path to the created audio file.",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["synthesize", "validate_input", "list_instruments", "list_soundfonts", "download_soundfont", "check_backends"],
        description: "Action to perform",
      },
      input_text: { type: "string", description: noteFormatDescription },
      tempo: { type: "number", description: 'Tempo in BPM (default: 120). Can also be set in input_text with "tempo:120"' },
      instrument: {
        type: ["number", "string"],
        description: 'GM instrument: number 0-127 or name like "piano", "violin", "guitar", "flute", "trumpet", "strings", "organ"',
      },
      soundfont: { type: "string", description: "SoundFont file name (default: MuseScore_General.sf2)" },
      output_format: { type: "string", enum: ["mp3", "wav", "midi"], description: "Output format (default: mp3)" },
      output_path: { type: "string", description: "Path for output file" },
      keep_midi: { type: "boolean", description: "Keep intermediate MIDI file (default: false)" },
      llm_preprocess: {
        type: "boolean",
        description: "Use LLM to extract clean note notation from input (default: true). Disable for raw note strings.",
      },
    },
    required: ["action"],
  },
  execute: executeMain,
};

const makeMusicTool: Tool = {
  name: "make_music",
  description:
    "CREATE AN AUDIO FILE (MP3/WAV) directly from a song description or note notation. CALL THIS TOOL DIRECTLY - do NOT write notes to a file first, do NOT use notepad. This tool handles everything: describe the music you want (e.g., \"Happy Birthday melody\") or provide notes, and it creates the audio file. Returns output_path to the playable audio file.",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      notes: {
        type: "string",
        description:
          'Music to create. Can be: (1) A description like "Happy Birthday melody" or "upbeat jazz riff", OR (2) Note notation like "C4:q D4:q E4:h". The tool will convert descriptions to notes automatically.',
      },
      tempo: { type: "number", description: "Tempo in BPM (default: 120)" },
      instrument: {
        type: ["number", "string"],
        description: 'Instrument: "piano", "violin", "guitar", "flute", "trumpet", "strings", or number 0-127',
      },
      format: { type: "string", enum: ["mp3", "wav", "midi"], description: "Output format (default: mp3)" },
      output_path: { type: "string", description: "Output file path" },
      llm_preprocess: { type: "boolean", description: "Convert descriptions to notes (default: true)" },
    },
    required: ["notes"],
  },
  execute: executeMakeMusic,
};

export { setLLMClient };
export default [midiMp3Tool, makeMusicTool];
