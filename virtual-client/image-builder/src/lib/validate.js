import { which } from "./exec.js";

export async function requireTools(tools) {
  const missing = [];
  for (const t of tools) {
    const found = await which(t);
    if (!found) missing.push(t);
  }
  if (missing.length) {
    throw new Error(
      `Missing required tools: ${missing.join(", ")}\n` +
      `Install them and re-run.`
    );
  }
}