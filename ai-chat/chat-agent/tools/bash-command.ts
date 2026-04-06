import { writeFile, unlink, mkdir, chmod } from "fs/promises";
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

const BLOCKED_PATTERNS = [
  "rm -rf /",
  "rm -rf /*",
  "mkfs",
  "dd if=/dev/zero",
  "dd if=/dev/random",
  ":(){ :|:& };:",
  "chmod -R 777 /",
  "chown -R",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "init 0",
  "init 6",
];

// ── Helpers ──────────────────────────────────────────────────

function checkSecurity(
  command: string,
  script: string | undefined,
  allowSudo: boolean,
  allowedCommands: string[] | null,
  blockedCommands: string[]
): { allowed: boolean; reason?: string } {
  const content = script ?? command;
  if (!allowSudo && content.includes("sudo ")) {
    return { allowed: false, reason: "sudo is not allowed" };
  }
  for (const blocked of blockedCommands) {
    if (content.includes(blocked)) {
      return { allowed: false, reason: `Blocked command pattern: ${blocked}` };
    }
  }
  if (allowedCommands) {
    const cmdName = command.split(/\s+/)[0].split("/").pop()!;
    if (!allowedCommands.includes(cmdName)) {
      return { allowed: false, reason: `Command not in allowlist: ${cmdName}` };
    }
  }
  return { allowed: true };
}

function runCommand(options: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeout: number;
  captureStderr: boolean;
  shell: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string; duration: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const cmdStr = options.command.endsWith(".sh")
      ? options.command
      : `${options.command} ${options.args.join(" ")}`;

    const mergedEnv = {
      ...process.env,
      ...options.env,
      PATH: `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: process.env.HOME ?? "/tmp",
      TERM: "xterm-256color",
      CI: "true",
      NPM_CONFIG_YES: "true",
      FORCE_COLOR: "0",
    };

    const proc = spawn(options.shell, ["-c", cmdStr], {
      cwd: options.cwd,
      env: mergedEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, options.timeout);

    proc.stdout.on("data", (data: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += data.toString();
    });

    if (options.captureStderr) {
      proc.stderr.on("data", (data: Buffer) => {
        if (stderr.length < MAX_OUTPUT) stderr += data.toString();
      });
    }

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: code ?? (timedOut ? 137 : 1),
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: stderr.slice(0, MAX_OUTPUT),
        duration: Date.now() - startTime,
        timedOut,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      resolve({ exitCode: 1, stdout: "", stderr: err.message, duration: Date.now() - startTime, timedOut: false });
    });
  });
}

// ── Execute ──────────────────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const command = args.command as string | undefined;
  const script = args.script as string | undefined;
  const cmdArgs = (args.args as string[]) ?? [];
  const env = (args.env as Record<string, string>) ?? {};
  const workingDir = args.workingDir as string | undefined;
  const timeout = args.timeout as number | undefined;
  const captureStderr = (args.captureStderr as boolean) ?? true;
  const shell = (args.shell as string) ?? "/bin/bash";
  const sessionId = args.sessionId as string | undefined;

  const allowSudo = (ctx.config.bashAllowSudo as boolean) ?? false;
  const allowedCommands = (ctx.config.bashAllowedCommands as string[] | null) ?? null;

  if (!command && !script) return formatError("Either command or script is required");
  if (!sessionId) return formatError("sessionId is required for sandbox isolation");

  const sandboxPath = await ctx.sandbox.ensureSandbox(sessionId);
  const cwd = workingDir ? join(sandboxPath, workingDir) : sandboxPath;

  if (!existsSync(cwd)) {
    await mkdir(cwd, { recursive: true, mode: 0o755 });
  }

  let scriptPath: string | null = null;
  let actualCommand = command;

  if (script) {
    scriptPath = join(sandboxPath, `.tmp-script-${randomUUID()}.sh`);
    let scriptContent = script;
    if (!scriptContent.startsWith("#!")) {
      scriptContent = `#!/bin/bash\nset -e\n${scriptContent}`;
    }
    await writeFile(scriptPath, scriptContent, { mode: 0o755 });
    await chmod(scriptPath, 0o755);
    actualCommand = scriptPath;
  }

  const securityCheck = checkSecurity(actualCommand ?? "", script, allowSudo, allowedCommands, BLOCKED_PATTERNS);
  if (!securityCheck.allowed) {
    if (scriptPath) await unlink(scriptPath).catch(() => {});
    return formatError(`Security violation: ${securityCheck.reason}`);
  }

  const effectiveTimeout = Math.min(timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

  try {
    const result = await runCommand({
      command: actualCommand!,
      args: cmdArgs,
      cwd,
      env: { ...env, SANDBOX_PATH: sandboxPath },
      timeout: effectiveTimeout,
      captureStderr,
      shell,
    });

    return formatResponse({
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
      timedOut: result.timedOut,
      sandboxPath,
      workingDir: cwd,
      command: command ?? "(script)",
    });
  } finally {
    if (scriptPath) await unlink(scriptPath).catch(() => {});
  }
}

// ── Tool Definition ─────────────────────────────────────────

const bashCommandTool: Tool = {
  name: "bash_command",
  description:
    "Execute bash commands or scripts in an isolated sandbox. Supports single commands or multi-line scripts with environment variables and working directory control.",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Session ID for sandbox isolation (required)" },
      command: { type: "string", description: "Single command to execute (alternative to script)" },
      script: { type: "string", description: "Multi-line bash script to execute (alternative to command)" },
      args: { type: "array", items: { type: "string" }, description: "Arguments to pass to the command" },
      env: { type: "object", additionalProperties: { type: "string" }, description: "Environment variables to set" },
      workingDir: { type: "string", description: "Working directory relative to sandbox root" },
      timeout: { type: "integer", default: 60000, description: "Execution timeout in milliseconds (max 600000)" },
      captureStderr: { type: "boolean", default: true, description: "Whether to capture stderr output" },
    },
    required: ["sessionId"],
  },
  execute,
};

export default bashCommandTool;
