import { writeFile, unlink, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { spawn } from "child_process";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 60_000;
const MAX_TIMEOUT = 600_000;
const MAX_OUTPUT = 10 * 1024 * 1024;

const DEFAULT_BLOCKED_MODULES = [
  "subprocess", "os.system", "os.popen", "os.spawn",
  "commands", "pty", "ctypes", "__builtins__.__import__",
];

/** Strip sensitive env vars — only pass safe execution context */
const ENV_ALLOWLIST = ["PATH", "LANG", "LC_ALL", "TERM", "CI"];
function sanitizeEnv(): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key]) safe[key] = process.env[key]!;
  }
  return safe;
}

// ── Helpers ──────────────────────────────────────────────────

function checkSecurity(code: string, blockedModules: string[]): { allowed: boolean; reason?: string } {
  for (const blocked of blockedModules) {
    const escaped = blocked.replace(".", "\\.");
    const patterns = [
      new RegExp(`import\\s+${escaped}`, "i"),
      new RegExp(`from\\s+${escaped}\\s+import`, "i"),
      new RegExp(`__import__\\s*\\(\\s*['"]${escaped}['"]`, "i"),
    ];
    for (const pattern of patterns) {
      if (pattern.test(code)) return { allowed: false, reason: `Blocked module: ${blocked}` };
    }
  }
  if (/eval\s*\(\s*input/i.test(code)) return { allowed: false, reason: "eval(input()) is not allowed" };
  if (/compile\s*\(.*\)\s*.*exec/i.test(code)) return { allowed: false, reason: "compile() with exec is not allowed" };
  return { allowed: true };
}

function installPackages(
  packages: string[],
  sandboxPath: string,
  pythonExe: string,
  approvedPackages: string[]
): Promise<{ success: boolean; error?: string }> {
  const filtered = approvedPackages.length > 0
    ? packages.filter((p) => approvedPackages.includes(p.split("==")[0].split("[")[0]))
    : packages;

  if (filtered.length === 0) return Promise.resolve({ success: true });

  return new Promise((resolve) => {
    const venvPath = join(sandboxPath, ".venv");
    const createVenv = !existsSync(venvPath);
    const cmd = createVenv
      ? `${pythonExe} -m venv ${venvPath} && ${venvPath}/bin/pip install ${filtered.join(" ")}`
      : `${venvPath}/bin/pip install ${filtered.join(" ")}`;

    const proc = spawn("/bin/bash", ["-c", cmd], { cwd: sandboxPath, timeout: 120_000 });
    let stderr = "";
    proc.stderr.on("data", (data) => { stderr += data.toString(); });
    proc.on("close", (code) => resolve(code === 0 ? { success: true } : { success: false, error: stderr || `Exit code: ${code}` }));
    proc.on("error", (err) => resolve({ success: false, error: err.message }));
  });
}

function runPython(options: {
  scriptPath: string; args: string[]; cwd: string;
  env: Record<string, string>; timeout: number; pythonExe: string; inputData?: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string; duration: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const venvPython = join(options.cwd, ".venv", "bin", "python");
    const actualPython = existsSync(venvPython) ? venvPython : options.pythonExe;

    const mergedEnv = {
      ...process.env,
      ...options.env,
      PATH: `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin`,
      HOME: process.env.HOME ?? "/tmp",
      TERM: "xterm-256color",
      CI: "true",
      PYTHONDONTWRITEBYTECODE: "1",
      FORCE_COLOR: "0",
    };

    const proc = spawn(actualPython, [options.scriptPath, ...options.args], {
      cwd: options.cwd,
      env: mergedEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timeoutId = setTimeout(() => { timedOut = true; proc.kill("SIGKILL"); }, options.timeout);

    if (options.inputData) proc.stdin.write(options.inputData);
    proc.stdin.end();

    proc.stdout.on("data", (data: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { if (stderr.length < MAX_OUTPUT) stderr += data.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({ exitCode: code ?? (timedOut ? 137 : 1), stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT), duration: Date.now() - startTime, timedOut });
    });
    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      resolve({ exitCode: 1, stdout: "", stderr: err.message, duration: Date.now() - startTime, timedOut: false });
    });
  });
}

// ── Execute ──────────────────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const code = args.code as string | undefined;
  const filePath = args.filePath as string | undefined;
  const scriptArgs = (args.args as string[]) ?? [];
  const env = (args.env as Record<string, string>) ?? {};
  const workingDir = args.workingDir as string | undefined;
  const timeout = args.timeout as number | undefined;
  const pythonVersion = args.pythonVersion as string | undefined;
  const installPkgs = (args.installPackages as string[]) ?? [];
  const inputData = args.inputData as string | undefined;

  const pythonPath = (ctx.config.pythonPath as string) ?? "python3";

  if (!code && !filePath) return formatError("Either code or filePath is required");
  if (!sessionId) return formatError("sessionId is required for sandbox isolation");

  const sandboxPath = await ctx.sandbox.ensureSandbox(sessionId);
  const cwd = workingDir ? join(sandboxPath, workingDir) : sandboxPath;
  if (!existsSync(cwd)) await mkdir(cwd, { recursive: true, mode: 0o755 });

  const pythonExe = pythonVersion ? `python${pythonVersion}` : pythonPath;

  if (installPkgs.length > 0) {
    const installResult = await installPackages(installPkgs, sandboxPath, pythonExe, (ctx.config.pipPackages as string[]) ?? []);
    if (!installResult.success) return formatError(`Failed to install packages: ${installResult.error}`);
  }

  let pythonCode = code;
  if (filePath) {
    let fullPath: string;
    try {
      fullPath = await ctx.sandbox.resolvePath(sessionId, filePath);
    } catch (err: any) {
      return formatError(`Path not allowed: ${err.message}`);
    }
    if (!existsSync(fullPath)) return formatError(`File not found: ${filePath}`);
    pythonCode = await readFile(fullPath, "utf-8");
  }

  const securityCheck = checkSecurity(pythonCode!, DEFAULT_BLOCKED_MODULES);
  if (!securityCheck.allowed) return formatError(`Security violation: ${securityCheck.reason}`);

  const scriptPath = join(sandboxPath, `.tmp-script-${randomUUID()}.py`);
  await writeFile(scriptPath, pythonCode!);

  const effectiveTimeout = Math.min(timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

  try {
    const result = await runPython({
      scriptPath, args: scriptArgs, cwd,
      env: { ...sanitizeEnv(), ...env, PYTHONPATH: sandboxPath, SANDBOX_PATH: sandboxPath, HOME: sandboxPath, TMPDIR: sandboxPath, PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1" },
      timeout: effectiveTimeout, pythonExe, inputData,
    });

    return formatResponse({
      success: result.exitCode === 0, exitCode: result.exitCode,
      stdout: result.stdout, stderr: result.stderr, duration: result.duration,
      timedOut: result.timedOut, sandboxPath, workingDir: cwd, pythonExecutable: pythonExe,
    });
  } finally {
    await unlink(scriptPath).catch(() => {});
  }
}

// ── Tool Definition ─────────────────────────────────────────

const pythonRunnerTool: Tool = {
  name: "python_runner",
  description:
    "Execute Python code in an isolated sandbox. Supports inline code or script files, package installation via pip, virtual environments, and stdin input.",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Session ID for sandbox isolation (required)" },
      code: { type: "string", description: "Python code to execute (alternative to filePath)" },
      filePath: { type: "string", description: "Path to Python file in sandbox (alternative to code)" },
      args: { type: "array", items: { type: "string" }, description: "Command-line arguments to pass to the script" },
      env: { type: "object", additionalProperties: { type: "string" }, description: "Environment variables to set" },
      workingDir: { type: "string", description: "Working directory relative to sandbox root" },
      timeout: { type: "integer", default: 60000, description: "Execution timeout in milliseconds (max 600000)" },
      pythonVersion: { type: "string", description: 'Python version to use (e.g., "3.11")' },
      installPackages: { type: "array", items: { type: "string" }, description: 'Pip packages to install before running (e.g., ["requests", "pandas==2.0.0"])' },
      inputData: { type: "string", description: "Data to send to stdin" },
    },
    required: ["sessionId"],
  },
  execute,
};

export default pythonRunnerTool;
