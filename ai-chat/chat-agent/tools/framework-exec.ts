import { spawn, execSync } from "child_process";
import { existsSync } from "fs";
import { mkdir, readFile, readdir, rename, writeFile } from "fs/promises";
import { join, dirname, basename } from "path";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ────────────────────────────────────────────────

const DEFAULT_DEV_PORT = 5173;

const DEFAULT_LIMITS = {
  timeout: 120000,
  outputSize: 1024 * 1024,
};

const MAX_LIMITS = {
  timeout: 600000,
  outputSize: 10 * 1024 * 1024,
};

// ── Framework Action Definitions ─────────────────────────────

interface ActionConfig {
  description: string;
  commands: Record<string, string[]> | null;
  internal?: boolean;
}

const FRAMEWORK_ACTIONS: Record<string, ActionConfig> = {
  dev: {
    description: "Start development server",
    commands: {
      default: ["bun", "run", "dev"],
      svelte: ["bun", "run", "dev"],
      next: ["bun", "run", "dev"],
      vite: ["bun", "run", "dev"],
      react: ["bun", "run", "start"],
    },
  },
  start: {
    description: "Start production server",
    commands: {
      default: ["bun", "run", "start"],
      next: ["bun", "run", "start"],
      svelte: ["bun", "run", "preview"],
    },
  },
  build: {
    description: "Build for production",
    commands: { default: ["bun", "run", "build"] },
  },
  test: {
    description: "Run tests",
    commands: {
      default: ["bun", "test"],
      vitest: ["bun", "run", "test"],
      jest: ["bun", "run", "test"],
    },
  },
  install: {
    description: "Install dependencies",
    commands: { default: ["bun", "install"] },
  },
  add: {
    description: "Add a dependency",
    commands: { default: ["bun", "add"] },
  },
  remove: {
    description: "Remove a dependency",
    commands: { default: ["bun", "remove"] },
  },
  lint: {
    description: "Run linter",
    commands: { default: ["bun", "run", "lint"] },
  },
  format: {
    description: "Format code",
    commands: {
      default: ["bun", "run", "format"],
      prettier: ["bunx", "prettier", "--write", "."],
    },
  },
  typecheck: {
    description: "Run type checking",
    commands: {
      default: ["bun", "run", "typecheck"],
      tsc: ["bunx", "tsc", "--noEmit"],
    },
  },
  create: {
    description: "Create new project from template",
    commands: {
      svelte: ["bunx", "sv", "create"],
      next: ["bunx", "create-next-app"],
      vite: ["bunx", "create-vite"],
      react: ["bunx", "create-react-app"],
    },
  },
  "run-script": {
    description: "Run a custom package.json script",
    commands: { default: ["bun", "run"] },
  },
  "validate-structure": {
    description: "Validate framework directory structure",
    commands: null,
    internal: true,
  },
  "reconcile-structure": {
    description: "Fix framework directory structure issues",
    commands: null,
    internal: true,
  },
};

// ── Framework Structures ─────────────────────────────────────

interface FrameworkStructure {
  requiredDirs: string[];
  optionalDirs: string[];
  requiredFiles: string[];
  optionalFiles: string[];
  entryPoints: string[];
  configFiles: string[];
  misplacements: Record<string, string>;
}

const FRAMEWORK_STRUCTURES: Record<string, FrameworkStructure> = {
  svelte: {
    requiredDirs: ["src", "src/routes"],
    optionalDirs: ["src/lib", "static"],
    requiredFiles: ["package.json", "svelte.config.js"],
    optionalFiles: ["vite.config.js", "vite.config.ts", "tsconfig.json"],
    entryPoints: ["src/routes/+page.svelte", "src/routes/+layout.svelte"],
    configFiles: ["svelte.config.js", "svelte.config.ts"],
    misplacements: {
      "+page.svelte": "src/routes/+page.svelte",
      "+layout.svelte": "src/routes/+layout.svelte",
      "+error.svelte": "src/routes/+error.svelte",
      "src/+page.svelte": "src/routes/+page.svelte",
      "src/+layout.svelte": "src/routes/+layout.svelte",
      "src/svelte.config.js": "svelte.config.js",
      "src/vite.config.js": "vite.config.js",
    },
  },
  next: {
    requiredDirs: [],
    optionalDirs: ["app", "pages", "public", "src/app", "src/pages"],
    requiredFiles: ["package.json"],
    optionalFiles: ["next.config.js", "next.config.mjs", "next.config.ts", "tsconfig.json"],
    entryPoints: ["app/page.tsx", "app/page.jsx", "pages/index.tsx", "pages/index.jsx", "src/app/page.tsx", "src/pages/index.tsx"],
    configFiles: ["next.config.js", "next.config.mjs", "next.config.ts"],
    misplacements: {
      "page.tsx": "app/page.tsx",
      "page.jsx": "app/page.jsx",
      "layout.tsx": "app/layout.tsx",
      "layout.jsx": "app/layout.jsx",
      "src/next.config.js": "next.config.js",
      "src/next.config.mjs": "next.config.mjs",
    },
  },
  vite: {
    requiredDirs: ["src"],
    optionalDirs: ["public"],
    requiredFiles: ["package.json", "index.html"],
    optionalFiles: ["vite.config.js", "vite.config.ts", "tsconfig.json"],
    entryPoints: ["src/main.jsx", "src/main.tsx", "src/main.js", "src/main.ts"],
    configFiles: ["vite.config.js", "vite.config.ts"],
    misplacements: {
      "main.jsx": "src/main.jsx",
      "main.tsx": "src/main.tsx",
      "main.js": "src/main.js",
      "App.jsx": "src/App.jsx",
      "App.tsx": "src/App.tsx",
      "src/index.html": "index.html",
      "public/index.html": "index.html",
    },
  },
  react: {
    requiredDirs: ["src", "public"],
    optionalDirs: [],
    requiredFiles: ["package.json", "public/index.html"],
    optionalFiles: ["tsconfig.json"],
    entryPoints: ["src/index.js", "src/index.jsx", "src/index.tsx"],
    configFiles: [],
    misplacements: {
      "index.js": "src/index.js",
      "index.jsx": "src/index.jsx",
      "index.tsx": "src/index.tsx",
      "App.js": "src/App.js",
      "App.jsx": "src/App.jsx",
      "App.tsx": "src/App.tsx",
      "index.html": "public/index.html",
    },
  },
};

// ── Helpers ──────────────────────────────────────────────────

function killProcessOnPort(port: number): { killed: number[]; message?: string; error?: string } {
  try {
    const lsofOutput = execSync(`lsof -i :${port} -t 2>/dev/null || true`, { encoding: "utf-8" }).trim();

    if (!lsofOutput) {
      return { killed: [], message: `Port ${port} is free` };
    }

    const pids = [...new Set(lsofOutput.split("\n").filter((p) => p.trim()))];
    const killed: number[] = [];

    for (const pid of pids) {
      try {
        execSync(`kill -9 -${pid} 2>/dev/null || kill -9 ${pid} 2>/dev/null || true`);
        killed.push(parseInt(pid, 10));
      } catch {
        try {
          execSync(`kill -9 ${pid} 2>/dev/null || true`);
          killed.push(parseInt(pid, 10));
        } catch {
          // Process may have already exited
        }
      }
    }

    try {
      const remaining = execSync(`lsof -i :${port} -t 2>/dev/null || true`, { encoding: "utf-8" }).trim();
      if (remaining) {
        const remainingPids = remaining.split("\n").filter((p) => p.trim());
        for (const pid of remainingPids) {
          execSync(`kill -9 ${pid} 2>/dev/null || true`);
          if (!killed.includes(parseInt(pid, 10))) {
            killed.push(parseInt(pid, 10));
          }
        }
      }
    } catch {
      // Ignore
    }

    return { killed, message: `Killed ${killed.length} process(es) on port ${port}` };
  } catch (err: any) {
    return { killed: [], error: err.message };
  }
}

async function detectFramework(dir: string): Promise<string | null> {
  try {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) return null;

    const content = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps["@sveltejs/kit"]) return "svelte";
    if (deps["next"]) return "next";
    if (deps["react-scripts"]) return "react";
    if (deps["vite"]) return "vite";
    if (deps["svelte"]) return "vite";
    if (deps["vitest"]) return "vitest";
    if (deps["jest"]) return "jest";

    return null;
  } catch {
    return null;
  }
}

interface ValidationResult {
  valid: boolean;
  framework: string;
  issues: Array<{ type: string; path?: string; paths?: string[]; from?: string; to?: string }>;
  suggestions: string[];
  misplacedFiles: Array<{ from: string; to: string }>;
  canReconcile: boolean;
  message?: string;
}

async function validateStructure(dir: string, framework: string): Promise<ValidationResult> {
  const structure = FRAMEWORK_STRUCTURES[framework];
  if (!structure) {
    return { valid: true, framework, issues: [], suggestions: [], misplacedFiles: [], canReconcile: false, message: "No structure definition for framework" };
  }

  const issues: ValidationResult["issues"] = [];
  const suggestions: string[] = [];

  for (const reqDir of structure.requiredDirs) {
    if (!existsSync(join(dir, reqDir))) {
      issues.push({ type: "missing_dir", path: reqDir });
      suggestions.push(`Create directory: ${reqDir}`);
    }
  }

  for (const reqFile of structure.requiredFiles) {
    if (!existsSync(join(dir, reqFile))) {
      issues.push({ type: "missing_file", path: reqFile });
      suggestions.push(`Missing required file: ${reqFile}`);
    }
  }

  const hasEntryPoint = structure.entryPoints.some((ep) => existsSync(join(dir, ep)));
  if (!hasEntryPoint && structure.entryPoints.length > 0) {
    issues.push({ type: "missing_entry", paths: structure.entryPoints });
    suggestions.push(`Missing entry point. Expected one of: ${structure.entryPoints.join(", ")}`);
  }

  const misplacedFiles: Array<{ from: string; to: string }> = [];
  for (const [wrongPath, correctPath] of Object.entries(structure.misplacements)) {
    if (existsSync(join(dir, wrongPath)) && !existsSync(join(dir, correctPath))) {
      misplacedFiles.push({ from: wrongPath, to: correctPath });
      issues.push({ type: "misplaced_file", from: wrongPath, to: correctPath });
      suggestions.push(`Move ${wrongPath} to ${correctPath}`);
    }
  }

  const hasConfig = structure.configFiles.length === 0 || structure.configFiles.some((cf) => existsSync(join(dir, cf)));
  if (!hasConfig) {
    issues.push({ type: "missing_config", paths: structure.configFiles });
    suggestions.push(`Missing config file. Expected one of: ${structure.configFiles.join(", ")}`);
  }

  return {
    valid: issues.length === 0,
    framework,
    issues,
    suggestions,
    misplacedFiles,
    canReconcile: misplacedFiles.length > 0 || issues.some((i) => i.type === "missing_dir"),
  };
}

async function reconcileStructure(dir: string, framework: string): Promise<{
  success: boolean;
  framework: string;
  actions: Array<{ type: string; path?: string; from?: string; to?: string }>;
  errors: Array<{ type: string; path?: string; from?: string; to?: string; error: string }>;
  remainingIssues: ValidationResult["issues"];
  message: string;
}> {
  const validation = await validateStructure(dir, framework);

  if (validation.valid) {
    return { success: true, framework, message: "Structure is already valid", actions: [], errors: [], remainingIssues: [] };
  }

  const structure = FRAMEWORK_STRUCTURES[framework];
  if (!structure) {
    return { success: false, framework, message: "No structure definition for framework", actions: [], errors: [], remainingIssues: [] };
  }

  const actions: Array<{ type: string; path?: string; from?: string; to?: string }> = [];
  const errors: Array<{ type: string; path?: string; from?: string; to?: string; error: string }> = [];

  for (const issue of validation.issues) {
    if (issue.type === "missing_dir" && issue.path) {
      try {
        await mkdir(join(dir, issue.path), { recursive: true });
        actions.push({ type: "created_dir", path: issue.path });
      } catch (err: any) {
        errors.push({ type: "create_dir_failed", path: issue.path, error: err.message });
      }
    }
  }

  for (const { from, to } of validation.misplacedFiles) {
    try {
      const targetDir = dirname(join(dir, to));
      if (!existsSync(targetDir)) {
        await mkdir(targetDir, { recursive: true });
      }
      await rename(join(dir, from), join(dir, to));
      actions.push({ type: "moved_file", from, to });
    } catch (err: any) {
      errors.push({ type: "move_failed", from, to, error: err.message });
    }
  }

  const postValidation = await validateStructure(dir, framework);

  return {
    success: errors.length === 0 && postValidation.valid,
    framework,
    actions,
    errors,
    remainingIssues: postValidation.issues,
    message:
      errors.length > 0
        ? `Reconciliation completed with ${errors.length} error(s)`
        : postValidation.valid
          ? "Structure successfully reconciled"
          : `Reconciliation completed but ${postValidation.issues.length} issue(s) remain`,
  };
}

async function scanForMisplacements(
  dir: string,
  framework: string
): Promise<{ framework: string; files: Array<{ found: string; expected: string; filename: string }>; suggestions: string[] }> {
  const structure = FRAMEWORK_STRUCTURES[framework];
  if (!structure) return { framework, files: [], suggestions: [] };

  const knownPatterns = Object.keys(structure.misplacements).map((p) => basename(p));
  const foundFiles: Array<{ found: string; expected: string; filename: string }> = [];

  const scan = async (currentDir: string, relativePath = ""): Promise<void> => {
    try {
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          await scan(join(currentDir, entry.name), entryRelPath);
        } else if (entry.isFile() && knownPatterns.includes(entry.name)) {
          const expectedPath = structure.misplacements[entry.name];
          if (expectedPath && entryRelPath !== expectedPath && !existsSync(join(dir, expectedPath))) {
            foundFiles.push({ found: entryRelPath, expected: expectedPath, filename: entry.name });
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  };

  await scan(dir);

  return { framework, files: foundFiles, suggestions: foundFiles.map((f) => `Move ${f.found} to ${f.expected}`) };
}

async function listKeyFiles(dir: string, maxDepth = 3): Promise<string[]> {
  const files: string[] = [];
  const importantExtensions = [".svelte", ".tsx", ".jsx", ".ts", ".js", ".vue", ".json", ".html", ".css"];
  const importantFiles = [
    "package.json", "tsconfig.json", "vite.config.ts", "vite.config.js",
    "svelte.config.js", "svelte.config.ts", "next.config.js", "next.config.mjs",
  ];

  const scan = async (currentDir: string, relativePath = "", depth = 0): Promise<void> => {
    if (depth > maxDepth) return;

    try {
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

        const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await scan(join(currentDir, entry.name), entryRelPath, depth + 1);
        } else if (entry.isFile()) {
          const isImportant =
            importantFiles.includes(entry.name) ||
            importantExtensions.some((ext) => entry.name.endsWith(ext));
          if (isImportant) files.push(entryRelPath);
        }
      }
    } catch {
      // Ignore read errors
    }
  };

  await scan(dir);
  return files.sort();
}

async function findCreatedProject(parentDir: string, extraArgs: string[]): Promise<string | null> {
  for (const arg of extraArgs) {
    if (!arg.startsWith("-") && !arg.startsWith(".")) {
      const potentialDir = join(parentDir, arg);
      if (existsSync(potentialDir) && existsSync(join(potentialDir, "package.json"))) {
        return potentialDir;
      }
    }
  }

  if (existsSync(join(parentDir, "package.json"))) return parentDir;

  try {
    const entries = await readdir(parentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        const subDir = join(parentDir, entry.name);
        if (existsSync(join(subDir, "package.json"))) return subDir;
      }
    }
  } catch {
    // Ignore errors
  }

  return null;
}

function buildCommand(
  action: string,
  framework: string | null,
  options: { scriptName?: string; packages?: string[]; extraArgs?: string[] } = {}
): string[] | null {
  const { scriptName, packages = [], extraArgs = [] } = options;
  const actionConfig = FRAMEWORK_ACTIONS[action];
  if (!actionConfig || !actionConfig.commands) return null;

  let cmd = actionConfig.commands[framework || ""] || actionConfig.commands.default;
  if (!cmd) return null;

  cmd = [...cmd];

  switch (action) {
    case "add":
    case "remove":
      if (packages.length === 0) return null;
      cmd.push(...packages);
      break;
    case "run-script":
      if (!scriptName) return null;
      cmd.push(scriptName);
      break;
    case "create":
      break;
  }

  if (extraArgs.length > 0) cmd.push(...extraArgs);

  return cmd;
}

function runCommand(options: {
  command: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  timeout: number;
  background: boolean;
}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timedOut: boolean;
  pid?: number;
}> {
  const { command, cwd, env, timeout, background } = options;

  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const mergedEnv: Record<string, string | undefined> = {
      ...process.env,
      ...env,
      PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}:/usr/local/bin:/usr/bin:/bin`,
      HOME: process.env.HOME || "/tmp",
      TERM: "xterm-256color",
    };

    const [cmd, ...args] = command;
    const proc = spawn(cmd, args, {
      cwd,
      env: mergedEnv as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
      detached: background,
    });

    if (background) {
      proc.unref();
      resolve({
        exitCode: 0,
        stdout: `Process started in background (PID: ${proc.pid})`,
        stderr: "",
        duration: Date.now() - startTime,
        timedOut: false,
        pid: proc.pid,
      });
      return;
    }

    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeout);

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

// ── Internal Action Handler ──────────────────────────────────

async function handleInternalAction(
  action: string,
  cwd: string,
  framework: string | null,
  sandboxPath: string
): Promise<ToolResult> {
  if (!framework) {
    return formatError("framework is required for structure validation. Auto-detection requires package.json.");
  }

  if (!FRAMEWORK_STRUCTURES[framework]) {
    return formatError(
      `No structure definition for framework: ${framework}. Supported: ${Object.keys(FRAMEWORK_STRUCTURES).join(", ")}`
    );
  }

  if (action === "validate-structure") {
    const validation = await validateStructure(cwd, framework);
    const scan = await scanForMisplacements(cwd, framework);
    return formatResponse({ success: validation.valid, action, framework, validation, deepScan: scan, sandboxPath, projectDir: cwd });
  }

  if (action === "reconcile-structure") {
    const reconciliation = await reconcileStructure(cwd, framework);
    return formatResponse({ success: reconciliation.success, action, framework, reconciliation, sandboxPath, projectDir: cwd });
  }

  return formatError(`Unknown internal action: ${action}`);
}

// ── Main Execute ─────────────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const {
    sessionId,
    action,
    framework,
    projectDir = "",
    scriptName,
    packages = [],
    extraArgs = [],
    env = {},
    timeout = DEFAULT_LIMITS.timeout,
    background: requestedBackground = false,
  } = args as {
    sessionId?: string;
    action?: string;
    framework?: string;
    projectDir?: string;
    scriptName?: string;
    packages?: string[];
    extraArgs?: string[];
    env?: Record<string, string>;
    timeout?: number;
    background?: boolean;
  };

  const longRunningActions = ["dev", "start"];
  const background = longRunningActions.includes(action || "") ? true : requestedBackground;

  if (!sessionId) return formatError("sessionId is required for sandbox isolation");
  if (!action) return formatError("action is required (e.g., dev, build, test, install)");

  const actionConfig = FRAMEWORK_ACTIONS[action];
  if (!actionConfig) {
    return formatError(`Unknown action: ${action}. Valid actions: ${Object.keys(FRAMEWORK_ACTIONS).join(", ")}`);
  }

  const sandboxPath = await ctx.sandbox.ensureSandbox(sessionId);
  const cwd = projectDir ? join(sandboxPath, projectDir) : sandboxPath;

  if (!existsSync(cwd)) {
    await mkdir(cwd, { recursive: true, mode: 0o755 });
  }

  const detectedFramework = framework || (await detectFramework(cwd));

  if (actionConfig.internal) {
    return handleInternalAction(action, cwd, detectedFramework, sandboxPath);
  }

  const command = buildCommand(action, detectedFramework, { scriptName, packages: packages as string[], extraArgs: extraArgs as string[] });
  if (!command) return formatError(`Cannot build command for action: ${action}`);

  let portCleanupResult: { killed: number[]; message?: string } | null = null;
  if (longRunningActions.includes(action)) {
    portCleanupResult = killProcessOnPort(DEFAULT_DEV_PORT);
    if (portCleanupResult.killed.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const effectiveTimeout = Math.min(timeout, MAX_LIMITS.timeout);

  try {
    const result = await runCommand({
      command,
      cwd,
      env: {
        ...env,
        SANDBOX_PATH: sandboxPath,
        BUN_INSTALL: process.env.BUN_INSTALL || join(process.env.HOME || "/tmp", ".bun"),
        FORCE_COLOR: "0",
        CI: "true",
      },
      timeout: effectiveTimeout,
      background,
    });

    let structureInfo: Record<string, unknown> | null = null;
    if (action === "create" && result.exitCode === 0) {
      const createdFramework = detectedFramework || framework;
      if (createdFramework && FRAMEWORK_STRUCTURES[createdFramework]) {
        const createdDir = await findCreatedProject(cwd, extraArgs as string[]);

        if (createdDir) {
          const validation = await validateStructure(createdDir, createdFramework);

          if (!validation.valid && validation.canReconcile) {
            const reconciliation = await reconcileStructure(createdDir, createdFramework);
            structureInfo = { validated: true, reconciled: true, reconciliation, projectDir: createdDir };
          } else {
            structureInfo = { validated: true, reconciled: false, validation, projectDir: createdDir };
          }

          structureInfo.keyFiles = await listKeyFiles(createdDir);
          structureInfo.relativePath = createdDir.replace(sandboxPath, "").replace(/^\//, "");
        }
      }
    }

    return formatResponse({
      success: result.exitCode === 0,
      action,
      framework: detectedFramework || "default",
      command: command.join(" "),
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
      timedOut: result.timedOut || false,
      background,
      backgroundAutoEnabled: longRunningActions.includes(action) && !requestedBackground,
      pid: result.pid,
      sandboxPath,
      projectDir: cwd,
      ...(structureInfo && { structureInfo }),
      ...(portCleanupResult?.killed?.length && portCleanupResult.killed.length > 0 && {
        portCleanup: { port: DEFAULT_DEV_PORT, killedPids: portCleanupResult.killed },
      }),
    });
  } catch (err: any) {
    return formatError(`Execution failed: ${err.message}`);
  }
}

// ── Tool Definition ──────────────────────────────────────────

const frameworkExecTool: Tool = {
  name: "framework_exec",
  description: `Execute framework commands using Bun runtime. Supports common development operations like dev server, build, test, install dependencies. Auto-detects framework from package.json. After 'create' action, automatically validates and reconciles directory structure. Actions: ${Object.keys(FRAMEWORK_ACTIONS).join(", ")}`,
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Session ID for sandbox isolation (required)" },
      action: {
        type: "string",
        enum: Object.keys(FRAMEWORK_ACTIONS),
        description:
          "Action to perform: dev (start dev server), build (production build), test (run tests), install (install deps), add/remove (manage deps), lint, format, typecheck, create (new project), run-script (custom script), validate-structure (check directory layout), reconcile-structure (fix directory issues)",
      },
      framework: {
        type: "string",
        enum: ["svelte", "next", "vite", "react", "vitest", "jest"],
        description: "Framework type (auto-detected if not specified). Required for validate-structure and reconcile-structure actions.",
      },
      projectDir: { type: "string", description: "Project directory relative to sandbox root" },
      scriptName: { type: "string", description: "Script name for run-script action" },
      packages: { type: "array", items: { type: "string" }, description: "Package names for add/remove actions" },
      extraArgs: { type: "array", items: { type: "string" }, description: "Additional arguments to pass to the command" },
      env: { type: "object", additionalProperties: { type: "string" }, description: "Additional environment variables" },
      timeout: { type: "integer", default: 120000, description: "Execution timeout in milliseconds (max 600000)" },
      background: {
        type: "boolean",
        default: false,
        description: "Run process in background. Auto-enabled for dev/start actions since they run indefinitely",
      },
    },
    required: ["sessionId", "action"],
  },
  execute,
};

export default frameworkExecTool;
