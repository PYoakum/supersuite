import { join, dirname } from "path";
import { mkdir } from "fs/promises";

export async function upload(basePath, key, buffer) {
  const filePath = join(basePath, key);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, buffer);
  return `/uploads/${key}`;
}

export async function remove(basePath, key) {
  const filePath = join(basePath, key);
  const file = Bun.file(filePath);
  if (await file.exists()) {
    const { unlink } = await import("fs/promises");
    await unlink(filePath);
  }
}

export function getUrl(key) {
  return `/uploads/${key}`;
}
