import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeManifest(outDir, manifest) {
  await mkdir(outDir, { recursive: true });
  const p = path.join(outDir, "manifest.json");
  await writeFile(p, JSON.stringify(manifest, null, 2), "utf8");
  return p;
}