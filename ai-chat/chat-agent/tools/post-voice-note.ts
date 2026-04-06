import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";
import { readFileSync, existsSync } from "fs";
import { resolve, extname } from "path";

const AUDIO_MIME: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
};

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const filePath = args.path as string | undefined;
  const transcript = (args.transcript as string) || "";
  const chatServerUrl = ctx.config.chatServerUrl as string;
  const agentId = ctx.config.agentId as string;
  const agentName = ctx.config.agentName as string;
  const agentChannel = (ctx.config.agentChannel as string) || "general";

  if (!chatServerUrl) return formatError("chatServerUrl not configured");
  if (!filePath) return formatError("path is required — use the tts/speak tool first to generate an audio file");

  // Accept absolute paths directly (from TTS tool output), or resolve relative to sandbox
  const sandboxPath = filePath.startsWith("/")
    ? filePath
    : ctx.sandbox
      ? resolve((ctx.sandbox as any).baseDir || "./sandbox", agentId, filePath)
      : resolve(filePath);

  if (!existsSync(sandboxPath)) {
    return formatError(`Audio file not found: ${filePath}. Use the 'speak' or 'tts' tool to generate it first.`);
  }

  const ext = extname(sandboxPath).toLowerCase();
  const mime = AUDIO_MIME[ext];
  if (!mime) return formatError(`Unsupported audio format: ${ext}. Supported: ${Object.keys(AUDIO_MIME).join(", ")}`);

  // Read and upload
  const data = readFileSync(sandboxPath);
  const b64 = Buffer.from(data).toString("base64");

  const uploadRes = await fetch(`${chatServerUrl}/api/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: b64, filename: filePath, mimeType: mime }),
  });

  const uploadData = await uploadRes.json() as any;
  if (!uploadData.ok) {
    return formatError(`Upload failed: ${uploadData.errors?.join(", ") || "unknown error"}`);
  }

  const audioUrl = `${chatServerUrl}${uploadData.url}`;

  // Post the audio message to chat
  const content = JSON.stringify({ url: audioUrl, transcript });
  const res = await fetch(`${chatServerUrl}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      senderType: "agent",
      senderId: agentId,
      displayName: agentName,
      content,
      contentFormat: "audio",
      channel: agentChannel,
      tags: ["voice-note"],
    }),
  });

  const msgData = await res.json() as any;
  if (!msgData.ok) {
    return formatError(`Failed to post voice note: ${msgData.errors?.join(", ") || "unknown"}`);
  }

  return formatResponse({
    posted: true,
    url: audioUrl,
    size: uploadData.size,
    transcript: transcript || null,
    messageId: msgData.message?.id,
  });
}

const postVoiceNoteTool: Tool = {
  name: "post_voice_note",
  description:
    "Post a voice note to the chat. First use the 'speak' or 'tts' tool to generate an audio file, " +
    "then use this tool to upload and post it. Include an optional transcript so humans can read it too.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the audio file in your sandbox (wav, mp3, ogg)" },
      transcript: { type: "string", description: "Text transcript of what was said (shown alongside the audio player)" },
    },
    required: ["path"],
  },
  execute,
};

export default postVoiceNoteTool;
