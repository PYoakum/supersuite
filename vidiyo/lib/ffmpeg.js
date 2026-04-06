/**
 * FFmpeg filter_complex builder and progress-parsing executor
 */

import { getFile, getMediaType } from "./uploads.js";

let ffmpegPath = "ffmpeg";

export function setFfmpegPath(p) {
  if (p) ffmpegPath = p;
}

/**
 * Build a complete ffmpeg command from a project definition.
 * Each timeline item gets its own -i input so the same file can appear multiple times.
 */
export function buildCommand(project, outputPath) {
  const { settings, timeline } = project;
  const tracks = timeline.tracks || [];

  // Build a flat list of inputs: one per timeline item
  // inputEntries[i] = { idx: i, path, fileId, item, track, mediaType }
  const inputEntries = [];

  for (const track of tracks) {
    for (const item of track.items || []) {
      const file = getFile(item.fileId);
      if (!file) continue;
      const mediaType = getMediaType(file.filename || "");
      inputEntries.push({
        idx: inputEntries.length,
        path: file.path,
        fileId: item.fileId,
        item,
        track,
        mediaType,
      });
    }
  }

  if (inputEntries.length === 0) {
    throw new Error("No valid input files found in project");
  }

  const filters = [];
  let videoOut = null;
  let audioOut = null;
  let labelIdx = 0;

  const label = (prefix) => `${prefix}${labelIdx++}`;

  // --- Main video track (concat) ---
  const mainVideoEntries = inputEntries.filter(
    e => e.track.type === "video"
  );

  if (mainVideoEntries.length === 1) {
    const e = mainVideoEntries[0];
    const { item } = e;
    const trimIn = item.trimIn || 0;
    const trimOut = item.trimOut || item.duration || 10;
    const vl = label("v");

    filters.push(
      `[${e.idx}:v]trim=start=${trimIn}:end=${trimOut},setpts=PTS-STARTPTS,` +
      `scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease,` +
      `pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2[${vl}]`
    );
    videoOut = vl;

    if (e.mediaType === "video") {
      const al = label("a");
      const vol = item.volume !== undefined ? item.volume : 1.0;
      filters.push(
        `[${e.idx}:a]atrim=start=${trimIn}:end=${trimOut},asetpts=PTS-STARTPTS,volume=${vol}[${al}]`
      );
      audioOut = al;
    }
  } else if (mainVideoEntries.length > 1) {
    const vLabels = [];
    const aLabels = [];

    for (const e of mainVideoEntries) {
      const { item } = e;
      const trimIn = item.trimIn || 0;
      const trimOut = item.trimOut || item.duration || 10;
      const vl = label("vc");

      filters.push(
        `[${e.idx}:v]trim=start=${trimIn}:end=${trimOut},setpts=PTS-STARTPTS,` +
        `scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease,` +
        `pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2[${vl}]`
      );
      vLabels.push(vl);

      // Generate a silent audio pad for clips without audio so concat stays aligned
      const al = label("ac");
      if (e.mediaType === "video") {
        const vol = item.volume !== undefined ? item.volume : 1.0;
        filters.push(
          `[${e.idx}:a]atrim=start=${trimIn}:end=${trimOut},asetpts=PTS-STARTPTS,volume=${vol}[${al}]`
        );
      } else {
        // Synthesize silence for image/audio-less clips
        const dur = trimOut - trimIn;
        filters.push(
          `anullsrc=r=44100:cl=stereo[_sil${e.idx}];[_sil${e.idx}]atrim=duration=${dur}[${al}]`
        );
      }
      aLabels.push(al);
    }

    const concatV = label("cv");
    const concatA = label("ca");
    const n = vLabels.length;
    const streamPairs = vLabels.map((v, i) => `[${v}][${aLabels[i]}]`).join("");
    filters.push(
      `${streamPairs}concat=n=${n}:v=1:a=1[${concatV}][${concatA}]`
    );
    videoOut = concatV;
    audioOut = concatA;
  }

  // --- Overlay tracks ---
  const overlayEntries = inputEntries.filter(e => e.track.type === "overlay");
  for (const e of overlayEntries) {
    if (!videoOut) continue;
    const { item } = e;
    const trimIn = item.trimIn || 0;
    const trimOut = item.trimOut || item.duration || 10;
    const x = item.position?.x || 0;
    const y = item.position?.y || 0;
    const w = item.size?.w || settings.width;
    const h = item.size?.h || settings.height;
    const opacity = item.opacity !== undefined ? item.opacity : 1.0;
    const startTime = item.startTime || 0;
    const endTime = startTime + (trimOut - trimIn);

    const oin = label("oin");
    if (e.mediaType === "image") {
      filters.push(
        `[${e.idx}:v]scale=${w}:${h},format=rgba,colorchannelmixer=aa=${opacity}[${oin}]`
      );
    } else {
      filters.push(
        `[${e.idx}:v]trim=start=${trimIn}:end=${trimOut},setpts=PTS-STARTPTS,` +
        `scale=${w}:${h},format=rgba,colorchannelmixer=aa=${opacity}[${oin}]`
      );
    }

    const blendMode = item.blendMode || "normal";
    if (blendMode !== "normal") {
      const bl = label("bl");
      filters.push(
        `[${videoOut}][${oin}]blend=all_mode=${blendMode}:all_opacity=${opacity}[${bl}]`
      );
      videoOut = bl;
    } else {
      const ovl = label("ovl");
      filters.push(
        `[${videoOut}][${oin}]overlay=x=${x}:y=${y}:enable='between(t,${startTime},${endTime})'[${ovl}]`
      );
      videoOut = ovl;
    }
  }

  // --- Audio tracks ---
  const audioMixInputs = audioOut ? [audioOut] : [];
  const audioEntries = inputEntries.filter(e => e.track.type === "audio");
  for (const e of audioEntries) {
    const { item } = e;
    const trimIn = item.trimIn || 0;
    const trimOut = item.trimOut || item.duration || 10;
    const vol = item.volume !== undefined ? item.volume : 1.0;
    const delay = Math.round((item.startTime || 0) * 1000);
    const fadeIn = item.fadeIn || 0;
    const fadeOut = item.fadeOut || 0;

    const al = label("at");
    let chain = `[${e.idx}:a]atrim=start=${trimIn}:end=${trimOut},asetpts=PTS-STARTPTS,volume=${vol}`;
    if (delay > 0) chain += `,adelay=${delay}|${delay}`;
    if (fadeIn > 0) chain += `,afade=t=in:d=${fadeIn}`;
    if (fadeOut > 0) chain += `,afade=t=out:st=${trimOut - trimIn - fadeOut}:d=${fadeOut}`;
    chain += `[${al}]`;
    filters.push(chain);
    audioMixInputs.push(al);
  }

  // Mix audio if multiple sources
  if (audioMixInputs.length > 1) {
    const mixed = label("mx");
    filters.push(
      `${audioMixInputs.map(l => `[${l}]`).join("")}amix=inputs=${audioMixInputs.length}:duration=longest[${mixed}]`
    );
    audioOut = mixed;
  } else if (audioMixInputs.length === 1) {
    audioOut = audioMixInputs[0];
  }

  // --- Build final command ---
  const args = [ffmpegPath, "-y"];

  for (const e of inputEntries) {
    args.push("-i", e.path);
  }

  if (filters.length > 0) {
    const filterStr = filters.join(";\n");
    console.log("[ffmpeg] filter_complex:\n" + filterStr);
    args.push("-filter_complex", filterStr);
    if (videoOut) args.push("-map", `[${videoOut}]`);
    if (audioOut) args.push("-map", `[${audioOut}]`);
  }

  args.push(
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-r", String(settings.fps || 30),
    outputPath
  );

  console.log("[ffmpeg] command:", args.join(" "));
  return args;
}

/**
 * Parse ffmpeg progress output.
 * Handles both -progress pipe:2 format (out_time_ms=) and regular stderr (time=HH:MM:SS).
 */
export function parseProgress(line) {
  const timeMatch = line.match(/out_time_ms=(\d+)/);
  const speedMatch = line.match(/speed=\s*([\d.]+)x/);
  const fpsMatch = line.match(/fps=\s*([\d.]+)/);

  if (timeMatch) {
    return {
      timeMs: parseInt(timeMatch[1]) / 1000,
      speed: speedMatch ? parseFloat(speedMatch[1]) : 0,
      fps: fpsMatch ? parseFloat(fpsMatch[1]) : 0,
    };
  }

  const timeHms = line.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2,3})/);
  if (timeHms) {
    const [, h, m, s, ms] = timeHms;
    const totalMs = (parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s)) * 1000 +
      parseInt(ms.padEnd(3, "0"));
    return {
      timeMs: totalMs,
      speed: speedMatch ? parseFloat(speedMatch[1]) : 0,
      fps: fpsMatch ? parseFloat(fpsMatch[1]) : 0,
    };
  }

  return null;
}

/**
 * Run ffmpeg with progress callback.
 */
export function runFfmpeg(args, onProgress) {
  return new Promise((resolve, reject) => {
    console.log("[ffmpeg] spawning:", args[0]);
    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    let stderrText = "";

    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    function readChunk() {
      reader.read().then(({ done, value }) => {
        if (done) return;
        const text = decoder.decode(value, { stream: true });
        stderrText += text;
        buffer += text;

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const progress = parseProgress(line);
          if (progress && onProgress) {
            onProgress(progress);
          }
        }

        readChunk();
      }).catch(() => {});
    }

    readChunk();

    proc.exited.then((code) => {
      if (code === 0) {
        console.log("[ffmpeg] completed successfully");
        resolve({ success: true });
      } else {
        const errMsg = stderrText.slice(-800);
        console.error("[ffmpeg] failed with code", code, ":", errMsg);
        reject(new Error(`ffmpeg exited with code ${code}: ${errMsg}`));
      }
    });
  });
}
