import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export async function* walkFiles(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(rootDir, ent.name);
    if (ent.isDirectory()) {
      yield* walkFiles(p);
    } else if (ent.isFile()) {
      yield p;
    }
  }
}

export async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}