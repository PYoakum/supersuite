import { writeFile, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { spawn } from "child_process";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse } from "./types";

// ── Constants ────────────────────────────────────────────────

const DEFAULT_DENY_MODULES = [
  "child_process", "cluster", "dgram", "dns", "net", "tls", "worker_threads", "vm",
];

const DEFAULT_LIMITS = { timeout: 30_000, memory: 512, outputSize: 1024 * 1024 };

/** Strip sensitive env vars — only pass safe execution context */
const ENV_ALLOWLIST = ["PATH", "LANG", "LC_ALL", "TERM", "CI", "NODE_ENV", "BUN_ENV"];
function sanitizeEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key]) safe[key] = process.env[key]!;
  }
  return { ...safe, ...overrides };
}
const MAX_LIMITS = { timeout: 300_000, memory: 2048, outputSize: 10 * 1024 * 1024 };

// ── Helpers ──────────────────────────────────────────────────

function wrapCode(code: string, denyModules: string[]): string {
  const denyBlock = denyModules.length
    ? `const __deniedModules = ${JSON.stringify(denyModules)};
const __originalRequire = require;
globalThis.require = (id) => {
  if (__deniedModules.some(m => id === m || id.startsWith(m + '/'))) throw new Error('Module not allowed: ' + id);
  return __originalRequire(id);
};`
    : "";

  return `import { createRequire as __createRequire } from 'module';
import { fileURLToPath as __fileURLToPath } from 'url';
import { dirname as __dirname } from 'path';
const __filename = __fileURLToPath(import.meta.url);
const __dirnameVal = __dirname(__filename);
const require = __createRequire(import.meta.url);
globalThis.__filename = __filename;
globalThis.__dirname = __dirnameVal;

const __startTime = Date.now();
const __consoleLogs = [];
const __originalConsole = { ...console };
['log', 'info', 'warn', 'error', 'debug'].forEach(level => {
  console[level] = (...args) => {
    __consoleLogs.push({ level, args: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)), timestamp: Date.now() });
    __originalConsole[level](...args);
  };
});

${denyBlock}

let __result;
let __error;
try {
  __result = await (async () => {
${code}
  })();
} catch (e) {
  __error = { name: e.name, message: e.message, stack: e.stack };
}

const __output = {
  execution: { duration: Date.now() - __startTime, timedOut: false },
  output: { console: __consoleLogs, returnValue: __error ? undefined : __result },
  error: __error
};
console.log('\\n__EXEC_RESULT__' + JSON.stringify(__output) + '__END_EXEC_RESULT__');
`;
}

async function checkRuntimeAvailable(runtime: string, nodeEnabled: boolean, bunEnabled: boolean): Promise<void> {
  if (runtime === "node" && !nodeEnabled) throw new Error("Node.js runtime is disabled");
  if (runtime === "bun" && !bunEnabled) throw new Error("Bun runtime is disabled");

  const cmd = runtime === "bun" ? "bun" : "node";
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, ["--version"], { timeout: 5000 });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} not found`))));
  });
}

function spawnAndCapture(
  cmd: string,
  args: string[],
  options: { env: Record<string, string | undefined>; cwd: string; timeout: number; maxOutput: number; stdin?: string }
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const proc = spawn(cmd, args, {
      env: options.env as NodeJS.ProcessEnv,
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timeoutId = setTimeout(() => { timedOut = true; proc.kill("SIGKILL"); }, options.timeout);

    if (options.stdin) proc.stdin.write(options.stdin);
    proc.stdin.end();

    proc.stdout.on("data", (data: Buffer) => { if (stdout.length < options.maxOutput) stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { if (stderr.length < options.maxOutput) stderr += data.toString(); });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      resolve({ execution: { exitCode: -1, duration: Date.now() - startTime, timedOut: false }, output: { stdout, stderr: err.message }, error: { name: "SpawnError", message: err.message } });
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      const resultMatch = stdout.match(/__EXEC_RESULT__(.+)__END_EXEC_RESULT__/s);

      if (resultMatch) {
        try {
          const parsed = JSON.parse(resultMatch[1]);
          resolve({
            execution: { exitCode: code, duration: parsed.execution?.duration ?? duration, timedOut },
            output: { stdout: stdout.replace(/__EXEC_RESULT__.+__END_EXEC_RESULT__/s, "").trim(), stderr, console: parsed.output?.console ?? [], returnValue: parsed.output?.returnValue },
            error: parsed.error,
          });
          return;
        } catch {}
      }

      resolve({
        execution: { exitCode: code, duration, timedOut },
        output: { stdout, stderr },
        error: code !== 0 ? { message: stderr || `Process exited with code ${code}` } : undefined,
      });
    });
  });
}

// ── Execute ──────────────────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const runtime = (args.runtime as string) ?? "node";
  const code = args.code as string | undefined;
  const entryPoint = args.entryPoint as string | undefined;
  const scriptArgs = (args.args as string[]) ?? [];
  const env = (args.env as Record<string, string>) ?? {};
  const permissions = (args.permissions as { network?: boolean; fileSystem?: string; denyModules?: string[] }) ?? {};
  const limits = (args.limits as { timeout?: number; memory?: number; outputSize?: number }) ?? {};
  const input = (args.input as { stdin?: string }) ?? {};

  const nodeEnabled = (ctx.config.jsNodeEnabled as boolean) ?? true;
  const bunEnabled = (ctx.config.jsBunEnabled as boolean) ?? true;

  if (!["node", "bun"].includes(runtime)) throw new Error(`Invalid runtime: ${runtime}`);
  if (!code && !entryPoint) throw new Error("Either code or entryPoint is required");

  await checkRuntimeAvailable(runtime, nodeEnabled, bunEnabled);

  const sandboxPath = await ctx.sandbox.ensureSandbox(sessionId);
  const execDir = join(sandboxPath, ".exec", randomUUID());
  await mkdir(execDir, { recursive: true });

  const effectiveLimits = {
    timeout: Math.min(limits.timeout ?? DEFAULT_LIMITS.timeout, MAX_LIMITS.timeout),
    memory: Math.min(limits.memory ?? DEFAULT_LIMITS.memory, MAX_LIMITS.memory),
    outputSize: Math.min(limits.outputSize ?? DEFAULT_LIMITS.outputSize, MAX_LIMITS.outputSize),
  };

  const denyModules = permissions.denyModules ?? DEFAULT_DENY_MODULES;
  const scriptPath = join(execDir, "script.mjs");
  let scriptContent: string;

  if (code) {
    scriptContent = wrapCode(code, denyModules);
  } else {
    const entryPath = await ctx.sandbox.resolvePath(sessionId, entryPoint!);
    if (!existsSync(entryPath)) throw new Error(`Entry point not found: ${entryPoint}`);
    scriptContent = `import('${entryPath}')
  .then(mod => { console.log('\\n__EXEC_RESULT__' + JSON.stringify({ execution: { duration: 0, timedOut: false }, output: { returnValue: mod.default || mod } }) + '__END_EXEC_RESULT__'); })
  .catch(e => { console.log('\\n__EXEC_RESULT__' + JSON.stringify({ error: { name: e.name, message: e.message, stack: e.stack } }) + '__END_EXEC_RESULT__'); });`;
  }

  await writeFile(scriptPath, scriptContent, "utf-8");

  try {
    const cmd = runtime === "bun" ? "bun" : "node";
    const cmdArgs = runtime === "bun"
      ? ["run", scriptPath, ...scriptArgs]
      : ["--experimental-vm-modules", `--max-old-space-size=${effectiveLimits.memory}`, scriptPath, ...scriptArgs];

    const result = await spawnAndCapture(cmd, cmdArgs, {
      env: sanitizeEnv({ ...env, HOME: sandboxPath, TMPDIR: sandboxPath }),
      cwd: sandboxPath,
      timeout: effectiveLimits.timeout,
      maxOutput: effectiveLimits.outputSize,
      stdin: input.stdin,
    });

    return formatResponse({ success: true, runtime, ...result });
  } finally {
    await rm(execDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Tool Definition ─────────────────────────────────────────

const jsExecuteTool: Tool = {
  name: "javascript_execute",
  description:
    "Execute JavaScript code in a sandboxed environment. Supports Node.js and Bun runtimes with console capture and module deny-lists.",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Session ID for sandbox isolation" },
      runtime: { type: "string", enum: ["node", "bun"], default: "node", description: "JavaScript runtime" },
      code: { type: "string", description: "JavaScript code to execute" },
      entryPoint: { type: "string", description: "Path to entry file in sandbox" },
      args: { type: "array", items: { type: "string" }, description: "Command-line arguments" },
      env: { type: "object", additionalProperties: { type: "string" }, description: "Environment variables" },
      permissions: {
        type: "object",
        properties: {
          network: { type: "boolean", default: false },
          fileSystem: { type: "string", enum: ["none", "read", "write"], default: "read" },
          denyModules: { type: "array", items: { type: "string" } },
        },
      },
      limits: {
        type: "object",
        properties: {
          timeout: { type: "integer", default: 30000 },
          memory: { type: "integer", default: 512 },
          outputSize: { type: "integer", default: 1048576 },
        },
      },
      input: { type: "object", properties: { stdin: { type: "string" } } },
    },
  },
  execute,
};

export default jsExecuteTool;
