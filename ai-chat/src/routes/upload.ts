import { join } from "path";
import { mkdirSync, existsSync } from "fs";

const UPLOAD_DIR = join(import.meta.dir, "..", "..", "public", "uploads");

function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
  "audio/wav", "audio/mpeg", "audio/ogg", "audio/mp3", "audio/webm", "audio/x-wav",
]);

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function handleUpload(req: Request): Promise<Response> {
  ensureUploadDir();

  let body: { data: string; filename?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, errors: ["Invalid JSON body"] }, { status: 400 });
  }

  if (!body.data) {
    return Response.json({ ok: false, errors: ["data (base64) is required"] }, { status: 400 });
  }

  const mime = body.mimeType || "image/png";
  if (!ALLOWED_MIME.has(mime)) {
    return Response.json(
      { ok: false, errors: [`Unsupported mime type: ${mime}. Allowed: ${[...ALLOWED_MIME].join(", ")}`] },
      { status: 400 },
    );
  }

  const buf = Buffer.from(body.data, "base64");
  if (buf.length > MAX_SIZE) {
    return Response.json({ ok: false, errors: [`File too large (${buf.length} bytes, max ${MAX_SIZE})`] }, { status: 400 });
  }

  const EXT_MAP: Record<string, string> = {
    "svg+xml": "svg", "mpeg": "mp3", "mp3": "mp3", "x-wav": "wav",
  };
  const rawExt = mime.split("/")[1] || "bin";
  const ext = EXT_MAP[rawExt] || rawExt;
  const name = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const filePath = join(UPLOAD_DIR, name);

  await Bun.write(filePath, buf);

  return Response.json({ ok: true, url: `/uploads/${name}`, size: buf.length });
}
