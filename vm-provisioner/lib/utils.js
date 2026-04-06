/**
 * Utility functions for vm-provisioner
 */

import { randomBytes } from "node:crypto";

export function generateId() {
  return randomBytes(6).toString("hex");
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Spawn a process and return { code, stdout, stderr }
 */
export async function exec(cmd, args = [], opts = {}) {
  const proc = Bun.spawn([cmd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    ...opts,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

/**
 * Spawn a long-running process (returns the Bun subprocess)
 */
export function spawn(cmd, args = [], opts = {}) {
  return Bun.spawn([cmd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    ...opts,
  });
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val == null || val.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = val;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function timestamp() {
  return new Date().toISOString();
}
