import { spawn } from "node:child_process";

export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });

    let out = "";
    let err = "";

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ out, err, code });
      else {
        const e = new Error(
          `Command failed (${code}): ${cmd} ${args.join(" ")}\n${err || out}`
        );
        e.code = code;
        e.stdout = out;
        e.stderr = err;
        reject(e);
      }
    });
  });
}

export async function which(binary) {
  try {
    const { out } = await run(process.platform === "win32" ? "where" : "which", [binary]);
    const first = out.trim().split(/\r?\n/)[0];
    return first || null;
  } catch {
    return null;
  }
}