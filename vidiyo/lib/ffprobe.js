/**
 * ffprobe wrapper - extract media metadata via Bun.spawn
 */

let ffprobePath = "ffprobe";

export function setFfprobePath(p) {
  if (p) ffprobePath = p;
}

export async function probe(filePath) {
  const proc = Bun.spawn([
    ffprobePath,
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ], { stdout: "pipe", stderr: "pipe" });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`ffprobe failed (exit ${exitCode}): ${stderr}`);
  }

  const data = JSON.parse(stdout);
  return parseProbeData(data);
}

function parseProbeData(data) {
  const format = data.format || {};
  const streams = data.streams || [];

  const videoStream = streams.find(s => s.codec_type === "video");
  const audioStream = streams.find(s => s.codec_type === "audio");

  const result = {
    duration: parseFloat(format.duration) || 0,
    size: parseInt(format.size) || 0,
    format: format.format_name || "",
    bitrate: parseInt(format.bit_rate) || 0,
  };

  if (videoStream) {
    result.video = {
      codec: videoStream.codec_name,
      width: videoStream.width,
      height: videoStream.height,
      fps: parseFps(videoStream.r_frame_rate || videoStream.avg_frame_rate),
      bitrate: parseInt(videoStream.bit_rate) || 0,
    };
  }

  if (audioStream) {
    result.audio = {
      codec: audioStream.codec_name,
      sampleRate: parseInt(audioStream.sample_rate) || 0,
      channels: audioStream.channels,
      bitrate: parseInt(audioStream.bit_rate) || 0,
    };
  }

  return result;
}

function parseFps(rateStr) {
  if (!rateStr) return 0;
  const parts = rateStr.split("/");
  if (parts.length === 2) {
    const num = parseInt(parts[0]);
    const den = parseInt(parts[1]);
    return den > 0 ? Math.round((num / den) * 100) / 100 : 0;
  }
  return parseFloat(rateStr) || 0;
}
