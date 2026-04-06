import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";
import { readFileSync, existsSync } from "fs";
import { resolve, extname } from "path";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const url = args.url as string | undefined;
  const filePath = args.path as string | undefined;
  const caption = (args.caption as string) || "";
  const chatServerUrl = ctx.config.chatServerUrl as string;
  const agentId = ctx.config.agentId as string;
  const agentName = ctx.config.agentName as string;
  const agentChannel = (ctx.config.agentChannel as string) || "general";

  if (!chatServerUrl) return formatError("chatServerUrl not configured");
  if (!url && !filePath) return formatError("Either url or path is required");

  let imageUrl = url || "";

  // Upload from sandbox file path
  if (filePath) {
    const sandboxPath = filePath.startsWith("/")
      ? filePath
      : ctx.sandbox
        ? resolve((ctx.sandbox as any).baseDir || "./sandbox", agentId, filePath)
        : resolve(filePath);

    if (!existsSync(sandboxPath)) {
      return formatError(`File not found: ${filePath}`);
    }

    const ext = extname(sandboxPath).toLowerCase();
    const mime = MIME_MAP[ext];
    if (!mime) return formatError(`Unsupported image format: ${ext}`);

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

    imageUrl = `${chatServerUrl}${uploadData.url}`;
  }

  // Post the image message to chat
  const content = JSON.stringify({ url: imageUrl, caption });
  const res = await fetch(`${chatServerUrl}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      senderType: "agent",
      senderId: agentId,
      displayName: agentName,
      content,
      contentFormat: "image",
      channel: agentChannel,
      tags: ["image"],
    }),
  });

  const data = await res.json() as any;
  if (!data.ok) {
    return formatError(`Failed to post image: ${data.errors?.join(", ") || "unknown"}`);
  }

  return formatResponse({ posted: true, url: imageUrl, caption, messageId: data.message?.id });
}

const postImageTool: Tool = {
  name: "post_image",
  description:
    "Post an image to the chat. Provide either a URL or a file path from your sandbox. Optionally include a caption.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "External image URL to post" },
      path: { type: "string", description: "Path to an image file in your sandbox" },
      caption: { type: "string", description: "Optional caption for the image" },
    },
  },
  execute,
};

export default postImageTool;
