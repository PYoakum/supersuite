import { writeFile, unlink, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { spawn } from "child_process";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ────────────────────────────────────────────────

const DEFAULT_LIMITS = { timeout: 60_000, outputSize: 1024 * 1024 };
const MAX_LIMITS = { timeout: 600_000, outputSize: 10 * 1024 * 1024 };

const DEFAULT_BLOCKED_IMPORTS = [
  "os/exec",
  "syscall",
  "unsafe",
  "plugin",
  "runtime/cgo",
  "C", // CGO
];

// ── Types ────────────────────────────────────────────────────

interface GoExecArgs {
  sessionId: string;
  code?: string;
  filePath?: string;
  action?: string;
  args?: string[];
  env?: Record<string, string>;
  workingDir?: string;
  timeout?: number;
  moduleName?: string;
  outputName?: string;
  buildFlags?: string[];
  testFlags?: string[];
  verbose?: boolean;
  inputData?: string;
}

interface GoExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timedOut: boolean;
}

interface SecurityCheck {
  allowed: boolean;
  reason?: string;
}

interface GoExecOptions {
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeout: number;
  inputData?: string;
}

// ── Config (module-level, set from ToolContext.config) ────────

function getGoPath(config: Record<string, unknown>): string {
  return (config.goPath as string) ?? "go";
}

function getBlockedImports(config: Record<string, unknown>): string[] {
  return (config.blockedImports as string[]) ?? DEFAULT_BLOCKED_IMPORTS;
}

function getAllowCGO(config: Record<string, unknown>): boolean {
  return (config.allowCGO as boolean) === true;
}

// ── Helpers ──────────────────────────────────────────────────

function checkSecurity(code: string, config: Record<string, unknown>): SecurityCheck {
  const blockedImports = getBlockedImports(config);
  const allowCGO = getAllowCGO(config);

  for (const blocked of blockedImports) {
    const patterns = [
      new RegExp(`import\\s+"${blocked}"`, "i"),
      new RegExp(`import\\s+\\w+\\s+"${blocked}"`, "i"),
      new RegExp(`"${blocked}"`, "i"),
    ];

    for (const pattern of patterns) {
      if (pattern.test(code)) {
        if (blocked === "C" && !allowCGO) {
          return { allowed: false, reason: 'CGO (import "C") is not allowed' };
        } else if (blocked !== "C") {
          return { allowed: false, reason: `Blocked import: ${blocked}` };
        }
      }
    }
  }

  if (/asm\s*\(/.test(code) || /go:linkname/.test(code)) {
    return { allowed: false, reason: "Inline assembly and go:linkname are not allowed" };
  }

  if (/\/\/go:noescape/.test(code)) {
    return { allowed: false, reason: "go:noescape directive is not allowed" };
  }

  return { allowed: true };
}

function executeGo(goPath: string, allowCGO: boolean, options: GoExecOptions): Promise<GoExecResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const goEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...options.env,
      PATH: `${process.env.PATH}:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin`,
      HOME: process.env.HOME || "/tmp",
      GOPATH: join(options.cwd, ".gopath"),
      GOCACHE: join(options.cwd, ".gocache"),
      GOMODCACHE: join(options.cwd, ".gomodcache"),
      GO111MODULE: "on",
      CGO_ENABLED: allowCGO ? "1" : "0",
    };

    const proc = spawn(goPath, options.args, {
      cwd: options.cwd,
      env: goEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, options.timeout);

    if (options.inputData) {
      proc.stdin.write(options.inputData);
    }
    proc.stdin.end();

    proc.stdout.on("data", (data: Buffer) => {
      if (stdout.length < MAX_LIMITS.outputSize) stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      if (stderr.length < MAX_LIMITS.outputSize) stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: code ?? (timedOut ? 137 : 1),
        stdout: stdout.slice(0, MAX_LIMITS.outputSize),
        stderr: stderr.slice(0, MAX_LIMITS.outputSize),
        duration: Date.now() - startTime,
        timedOut,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: err.message,
        duration: Date.now() - startTime,
        timedOut: false,
      });
    });
  });
}

// ── Action handlers ──────────────────────────────────────────

async function runCode(parsed: GoExecArgs, sandboxPath: string, cwd: string, config: Record<string, unknown>): Promise<ToolResult> {
  const { code, filePath, args: programArgs = [], env = {}, timeout = DEFAULT_LIMITS.timeout, buildFlags = [], inputData } = parsed;

  let scriptPath: string | null = null;
  let createdFile = false;

  try {
    let goCode: string;
    if (code) {
      goCode = code;
      scriptPath = join(cwd, `main_${randomUUID().slice(0, 8)}.go`);
      await writeFile(scriptPath, goCode);
      createdFile = true;
    } else if (filePath) {
      scriptPath = join(sandboxPath, filePath);
      if (!existsSync(scriptPath)) {
        return formatError(`File not found: ${filePath}`);
      }
      goCode = await readFile(scriptPath, "utf-8");
    } else {
      return formatError("Either code or filePath is required");
    }

    const sec = checkSecurity(goCode, config);
    if (!sec.allowed) return formatError(`Security violation: ${sec.reason}`);

    const effectiveTimeout = Math.min(timeout, MAX_LIMITS.timeout);
    const goArgs = ["run", ...buildFlags, scriptPath!, ...programArgs];

    const result = await executeGo(getGoPath(config), getAllowCGO(config), {
      args: goArgs,
      cwd,
      env,
      timeout: effectiveTimeout,
      inputData,
    });

    return formatResponse({
      success: result.exitCode === 0,
      action: "run",
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
      timedOut: result.timedOut,
      sandboxPath,
      workingDir: cwd,
    });
  } finally {
    if (createdFile && scriptPath) {
      await unlink(scriptPath).catch(() => {});
    }
  }
}

async function buildCode(parsed: GoExecArgs, sandboxPath: string, cwd: string, config: Record<string, unknown>): Promise<ToolResult> {
  const { code, filePath, outputName, buildFlags = [], timeout = DEFAULT_LIMITS.timeout } = parsed;

  let scriptPath: string | null = null;
  let createdFile = false;

  try {
    let goCode: string;
    if (code) {
      goCode = code;
      scriptPath = join(cwd, `main_${randomUUID().slice(0, 8)}.go`);
      await writeFile(scriptPath, goCode);
      createdFile = true;
    } else if (filePath) {
      scriptPath = join(sandboxPath, filePath);
      if (!existsSync(scriptPath)) {
        return formatError(`File not found: ${filePath}`);
      }
      goCode = await readFile(scriptPath, "utf-8");
    } else {
      return formatError("Either code or filePath is required");
    }

    const sec = checkSecurity(goCode, config);
    if (!sec.allowed) return formatError(`Security violation: ${sec.reason}`);

    const output = outputName || "main";
    const outputPath = join(cwd, output);
    const effectiveTimeout = Math.min(timeout, MAX_LIMITS.timeout);
    const goArgs = ["build", "-o", outputPath, ...buildFlags, scriptPath!];

    const result = await executeGo(getGoPath(config), getAllowCGO(config), {
      args: goArgs,
      cwd,
      env: {},
      timeout: effectiveTimeout,
    });

    return formatResponse({
      success: result.exitCode === 0,
      action: "build",
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
      outputPath: result.exitCode === 0 ? output : null,
      sandboxPath,
      workingDir: cwd,
    });
  } finally {
    if (createdFile && scriptPath) {
      await unlink(scriptPath).catch(() => {});
    }
  }
}

async function runTests(parsed: GoExecArgs, sandboxPath: string, cwd: string, config: Record<string, unknown>): Promise<ToolResult> {
  const { filePath, testFlags = [], timeout = DEFAULT_LIMITS.timeout, verbose = true } = parsed;

  const testTarget = filePath ? join(sandboxPath, filePath) : "./...";
  const effectiveTimeout = Math.min(timeout, MAX_LIMITS.timeout);

  const goArgs = ["test"];
  if (verbose) goArgs.push("-v");
  goArgs.push(...testFlags, testTarget);

  const result = await executeGo(getGoPath(config), getAllowCGO(config), {
    args: goArgs,
    cwd,
    env: {},
    timeout: effectiveTimeout,
  });

  return formatResponse({
    success: result.exitCode === 0,
    action: "test",
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    duration: result.duration,
    sandboxPath,
    workingDir: cwd,
  });
}

async function modInit(parsed: GoExecArgs, sandboxPath: string, cwd: string, config: Record<string, unknown>): Promise<ToolResult> {
  const { moduleName = "sandbox/app", timeout = DEFAULT_LIMITS.timeout } = parsed;

  const goModPath = join(cwd, "go.mod");
  if (existsSync(goModPath)) {
    return formatResponse({
      success: true,
      action: "mod-init",
      message: "go.mod already exists",
      moduleName,
      sandboxPath,
      workingDir: cwd,
    });
  }

  const result = await executeGo(getGoPath(config), getAllowCGO(config), {
    args: ["mod", "init", moduleName],
    cwd,
    env: {},
    timeout: Math.min(timeout, MAX_LIMITS.timeout),
  });

  return formatResponse({
    success: result.exitCode === 0,
    action: "mod-init",
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    moduleName,
    sandboxPath,
    workingDir: cwd,
  });
}

async function modTidy(parsed: GoExecArgs, sandboxPath: string, cwd: string, config: Record<string, unknown>): Promise<ToolResult> {
  const { timeout = DEFAULT_LIMITS.timeout } = parsed;

  const result = await executeGo(getGoPath(config), getAllowCGO(config), {
    args: ["mod", "tidy"],
    cwd,
    env: {},
    timeout: Math.min(timeout, MAX_LIMITS.timeout),
  });

  return formatResponse({
    success: result.exitCode === 0,
    action: "mod-tidy",
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    sandboxPath,
    workingDir: cwd,
  });
}

async function formatCode(parsed: GoExecArgs, sandboxPath: string, cwd: string, config: Record<string, unknown>): Promise<ToolResult> {
  const { filePath, timeout = DEFAULT_LIMITS.timeout } = parsed;

  const target = filePath ? join(sandboxPath, filePath) : "./...";

  const result = await executeGo(getGoPath(config), getAllowCGO(config), {
    args: ["fmt", target],
    cwd,
    env: {},
    timeout: Math.min(timeout, MAX_LIMITS.timeout),
  });

  return formatResponse({
    success: result.exitCode === 0,
    action: "fmt",
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    sandboxPath,
    workingDir: cwd,
  });
}

async function vetCode(parsed: GoExecArgs, sandboxPath: string, cwd: string, config: Record<string, unknown>): Promise<ToolResult> {
  const { filePath, timeout = DEFAULT_LIMITS.timeout } = parsed;

  const target = filePath ? join(sandboxPath, filePath) : "./...";

  const result = await executeGo(getGoPath(config), getAllowCGO(config), {
    args: ["vet", target],
    cwd,
    env: {},
    timeout: Math.min(timeout, MAX_LIMITS.timeout),
  });

  return formatResponse({
    success: result.exitCode === 0,
    action: "vet",
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    sandboxPath,
    workingDir: cwd,
  });
}

// ── Execute entry point ──────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const parsed: GoExecArgs = {
    sessionId: args.sessionId as string,
    code: args.code as string | undefined,
    filePath: args.filePath as string | undefined,
    action: (args.action as string) ?? "run",
    args: (args.args as string[]) ?? [],
    env: (args.env as Record<string, string>) ?? {},
    workingDir: args.workingDir as string | undefined,
    timeout: (args.timeout as number) ?? DEFAULT_LIMITS.timeout,
    moduleName: args.moduleName as string | undefined,
    outputName: args.outputName as string | undefined,
    buildFlags: (args.buildFlags as string[]) ?? [],
    testFlags: (args.testFlags as string[]) ?? [],
    verbose: (args.verbose as boolean) ?? true,
    inputData: args.inputData as string | undefined,
  };

  if (!parsed.sessionId) {
    return formatError("sessionId is required for sandbox isolation");
  }

  if (!parsed.code && !parsed.filePath && parsed.action !== "mod-init" && parsed.action !== "mod-tidy") {
    return formatError("Either code or filePath is required (except for mod-init/mod-tidy)");
  }

  const sandboxPath = await ctx.sandbox.ensureSandbox(parsed.sessionId);
  const cwd = parsed.workingDir ? join(sandboxPath, parsed.workingDir) : sandboxPath;

  if (!existsSync(cwd)) {
    await mkdir(cwd, { recursive: true, mode: 0o755 });
  }

  switch (parsed.action) {
    case "run":
      return runCode(parsed, sandboxPath, cwd, ctx.config);
    case "build":
      return buildCode(parsed, sandboxPath, cwd, ctx.config);
    case "test":
      return runTests(parsed, sandboxPath, cwd, ctx.config);
    case "mod-init":
      return modInit(parsed, sandboxPath, cwd, ctx.config);
    case "mod-tidy":
      return modTidy(parsed, sandboxPath, cwd, ctx.config);
    case "fmt":
      return formatCode(parsed, sandboxPath, cwd, ctx.config);
    case "vet":
      return vetCode(parsed, sandboxPath, cwd, ctx.config);
    default:
      return formatError(`Unknown action: ${parsed.action}. Use: run, build, test, mod-init, mod-tidy, fmt, vet`);
  }
}

// ── Tool Definition ─────────────────────────────────────────

const golangExecTool: Tool = {
  name: "golang_exec",
  description: `Execute Go code in an isolated sandbox. Supports multiple actions:

ACTIONS:
- run: Execute Go code directly (go run)
- build: Compile Go code to binary (go build)
- test: Run Go tests (go test)
- mod-init: Initialize Go module (go mod init)
- mod-tidy: Tidy Go module dependencies (go mod tidy)
- fmt: Format Go code (go fmt)
- vet: Run Go vet for static analysis (go vet)

SECURITY:
- Blocked imports: os/exec, syscall, unsafe, plugin, CGO
- No inline assembly or go:linkname
- Sandboxed file system access

WORKFLOW EXAMPLE:
1. action="mod-init" with moduleName="myapp"
2. action="run" with code="package main..."
3. action="build" to compile
4. action="test" to run tests`,
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID for sandbox isolation (required)",
      },
      action: {
        type: "string",
        enum: ["run", "build", "test", "mod-init", "mod-tidy", "fmt", "vet"],
        default: "run",
        description: "Action to perform",
      },
      code: {
        type: "string",
        description: "Go source code to execute (alternative to filePath)",
      },
      filePath: {
        type: "string",
        description: "Path to Go file in sandbox (alternative to code)",
      },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Command-line arguments to pass to the program (for run action)",
      },
      env: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Environment variables to set",
      },
      workingDir: {
        type: "string",
        description: "Working directory relative to sandbox root",
      },
      timeout: {
        type: "integer",
        default: 60000,
        description: "Execution timeout in milliseconds (max 600000)",
      },
      moduleName: {
        type: "string",
        default: "sandbox/app",
        description: "Module name for mod-init action",
      },
      outputName: {
        type: "string",
        description: "Output binary name for build action",
      },
      buildFlags: {
        type: "array",
        items: { type: "string" },
        description: 'Additional flags for go build/run (e.g., ["-ldflags", "-s -w"])',
      },
      testFlags: {
        type: "array",
        items: { type: "string" },
        description: 'Additional flags for go test (e.g., ["-cover", "-race"])',
      },
      verbose: {
        type: "boolean",
        default: true,
        description: "Verbose output for test action",
      },
      inputData: {
        type: "string",
        description: "Data to send to stdin",
      },
    },
    required: ["sessionId"],
  },
  execute,
};

export default golangExecTool;
