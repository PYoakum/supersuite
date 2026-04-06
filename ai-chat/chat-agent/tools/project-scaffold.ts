import { mkdir, writeFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { spawn } from "child_process";
import { join } from "path";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 300_000; // 5 minutes
const MAX_OUTPUT = 1024 * 1024;

// ── Project Types ────────────────────────────────────────────

interface ProjectType {
  name: string;
  description: string;
  getCommand: (projectName: string, opts: Record<string, unknown>) => { runtime: string; args: string[] } | null;
  postCreate: string[];
  files?: (name: string, opts: Record<string, unknown>) => Record<string, string>;
}

const PROJECT_TYPES: Record<string, ProjectType> = {
  react: {
    name: "React (Vite)",
    description: "React application with Vite bundler",
    getCommand: (name, opts) => {
      let template = "react";
      if (opts.typescript && opts.swc) template = "react-swc-ts";
      else if (opts.typescript) template = "react-ts";
      else if (opts.swc) template = "react-swc";
      return { runtime: "bun", args: ["create", "vite@latest", name, "--template", template] };
    },
    postCreate: ["bun install"],
  },

  next: {
    name: "Next.js",
    description: "Next.js React framework with SSR, API routes, App Router",
    getCommand: (name, opts) => {
      const args = ["create", "next-app@latest", name, "--use-bun"];
      args.push(opts.typescript !== false ? "--typescript" : "--javascript");
      args.push(opts.tailwind ? "--tailwind" : "--no-tailwind");
      args.push(opts.eslint !== false ? "--eslint" : "--no-eslint");
      args.push(opts.srcDir ? "--src-dir" : "--no-src-dir");
      args.push(opts.appRouter !== false ? "--app" : "--pages");
      args.push("--import-alias", (opts.importAlias as string) ?? "@/*");
      return { runtime: "bun", args };
    },
    postCreate: [],
  },

  svelte: {
    name: "SvelteKit",
    description: "SvelteKit full-stack framework",
    getCommand: (name, opts) => {
      const args = ["create", "svelte@latest", name];
      if (opts.typescript) args.push("--types", "typescript");
      return { runtime: "bun", args };
    },
    postCreate: ["bun install"],
  },

  astro: {
    name: "Astro",
    description: "Astro static site generator with island architecture",
    getCommand: (name, opts) => {
      const args = ["create", "astro@latest", name, "--", "--skip-houston"];
      if (opts.template) args.push("--template", opts.template as string);
      if (opts.typescript !== false) args.push("--typescript", "strict");
      return { runtime: "bun", args };
    },
    postCreate: ["bun install"],
  },

  fastapi: {
    name: "FastAPI",
    description: "FastAPI Python web framework",
    getCommand: () => null, // Uses file generation
    postCreate: [],
    files: (name) => ({
      "requirements.txt": "fastapi[standard]>=0.115.0\nuvicorn[standard]>=0.30.0\n",
      "main.py": `from fastapi import FastAPI

app = FastAPI(title="${name}")

@app.get("/")
async def root():
    return {"message": "Hello from ${name}"}

@app.get("/health")
async def health():
    return {"status": "ok"}
`,
      ".gitignore": "__pycache__/\n*.pyc\n.env\nvenv/\n.venv/\n",
    }),
  },

  bun: {
    name: "Bun Server",
    description: "Minimal Bun HTTP server",
    getCommand: () => null,
    postCreate: [],
    files: (name, opts) => ({
      "package.json": JSON.stringify({
        name,
        version: "1.0.0",
        type: "module",
        scripts: { dev: "bun run --hot server.ts", start: "bun run server.ts" },
      }, null, 2),
      "server.ts": `const PORT = parseInt(Bun.env.PORT ?? "3000");

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") return Response.json({ message: "Hello from ${name}" });
    if (url.pathname === "/health") return Response.json({ status: "ok" });
    return new Response("Not Found", { status: 404 });
  },
});

console.log(\`Server running on http://localhost:\${server.port}\`);
`,
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ESNext", module: "ESNext", moduleResolution: "bundler",
          types: ["bun-types"], strict: true, esModuleInterop: true,
        },
      }, null, 2),
    }),
  },
};

// ── Helpers ──────────────────────────────────────────────────

function runShellCommand(command: string, cwd: string, timeout: number): Promise<{ exitCode: number; stdout: string; stderr: string; duration: number }> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const proc = spawn("/bin/bash", ["-c", command], {
      cwd,
      env: { ...process.env, CI: "true", NPM_CONFIG_YES: "true", FORCE_COLOR: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timeoutId = setTimeout(() => { timedOut = true; proc.kill("SIGKILL"); }, timeout);

    proc.stdout.on("data", (data: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { if (stderr.length < MAX_OUTPUT) stderr += data.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({ exitCode: code ?? (timedOut ? 137 : 1), stdout, stderr, duration: Date.now() - startTime });
    });
    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      resolve({ exitCode: 1, stdout: "", stderr: err.message, duration: Date.now() - startTime });
    });
  });
}

// ── Execute ──────────────────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const projectType = args.type as string | undefined;
  const projectName = args.name as string | undefined;
  const options = (args.options as Record<string, unknown>) ?? {};

  if (!projectType) return formatError(`type is required. Available: ${Object.keys(PROJECT_TYPES).join(", ")}`);
  if (!projectName) return formatError("name is required");

  const typeConfig = PROJECT_TYPES[projectType];
  if (!typeConfig) return formatError(`Unknown project type: ${projectType}. Available: ${Object.keys(PROJECT_TYPES).join(", ")}`);

  const sandboxPath = await ctx.sandbox.ensureSandbox(sessionId);
  const projectDir = join(sandboxPath, projectName);

  if (existsSync(projectDir)) return formatError(`Directory already exists: ${projectName}`);

  const steps: { step: string; success: boolean; duration?: number; error?: string }[] = [];

  // Step 1: Create project (command or files)
  const cmd = typeConfig.getCommand(projectName, options);

  if (cmd) {
    const cmdStr = cmd.runtime === "bunx"
      ? `bunx ${cmd.args.join(" ")}`
      : `${cmd.runtime} ${cmd.args.join(" ")}`;

    const result = await runShellCommand(cmdStr, sandboxPath, DEFAULT_TIMEOUT);
    steps.push({ step: `create (${cmdStr.slice(0, 80)})`, success: result.exitCode === 0, duration: result.duration, error: result.exitCode !== 0 ? result.stderr.slice(0, 500) : undefined });

    if (result.exitCode !== 0) {
      return formatResponse({ success: false, type: projectType, name: projectName, steps });
    }
  } else if (typeConfig.files) {
    await mkdir(projectDir, { recursive: true });
    const files = typeConfig.files(projectName, options);
    for (const [filePath, content] of Object.entries(files)) {
      const absPath = join(projectDir, filePath);
      const dir = join(absPath, "..");
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      await writeFile(absPath, content, "utf-8");
    }
    steps.push({ step: `create (${Object.keys(files).length} files)`, success: true });
  }

  // Step 2: Post-create commands
  for (const postCmd of typeConfig.postCreate) {
    if (!existsSync(projectDir)) break;
    const result = await runShellCommand(postCmd, projectDir, DEFAULT_TIMEOUT);
    steps.push({ step: postCmd, success: result.exitCode === 0, duration: result.duration, error: result.exitCode !== 0 ? result.stderr.slice(0, 500) : undefined });
  }

  // Gather final directory listing
  let fileList: string[] = [];
  if (existsSync(projectDir)) {
    const entries = await readdir(projectDir);
    fileList = entries.slice(0, 30);
  }

  return formatResponse({
    success: steps.every((s) => s.success),
    type: projectType,
    typeName: typeConfig.name,
    name: projectName,
    projectDir,
    steps,
    files: fileList,
  });
}

// ── Tool Definition ─────────────────────────────────────────

const projectScaffoldTool: Tool = {
  name: "project_scaffold",
  description:
    `Create new project from templates. Supported types: ${Object.entries(PROJECT_TYPES).map(([k, v]) => `${k} (${v.description})`).join(", ")}. Uses Bun for package management.`,
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Session ID for sandbox isolation" },
      type: {
        type: "string",
        enum: Object.keys(PROJECT_TYPES),
        description: "Project type to create",
      },
      name: { type: "string", description: "Project name (used as directory name)" },
      options: {
        type: "object",
        description: "Type-specific options",
        properties: {
          typescript: { type: "boolean", default: true, description: "Enable TypeScript" },
          tailwind: { type: "boolean", default: false, description: "Include Tailwind CSS (Next.js)" },
          eslint: { type: "boolean", default: true, description: "Include ESLint" },
          swc: { type: "boolean", default: false, description: "Use SWC compiler (React/Vite)" },
          srcDir: { type: "boolean", default: false, description: "Use src/ directory (Next.js)" },
          appRouter: { type: "boolean", default: true, description: "Use App Router (Next.js)" },
          template: { type: "string", description: "Framework-specific template name" },
        },
      },
    },
    required: ["type", "name"],
  },
  execute,
};

export default projectScaffoldTool;
