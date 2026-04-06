import { spawn } from "child_process";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Constants ──────────────────────────────────────────────

const DEFAULT_BINARY = "rs-label";
const DEFAULT_TIMEOUT = 30_000;

const ACTIONS = ["discover", "status", "print"] as const;

type Action = (typeof ACTIONS)[number];

// ── Helpers ────────────────────────────────────────────────

function runCommand(
  cmd: string,
  args: string[],
  timeout = DEFAULT_TIMEOUT
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ── Actions ────────────────────────────────────────────────

async function actionDiscover(binary: string): Promise<ToolResult> {
  const result = await runCommand(binary, ["discover"]);
  if (result.exitCode !== 0) {
    return formatError(`discover failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }
  return formatResponse({ action: "discover", output: result.stdout.trim() });
}

async function actionStatus(binary: string): Promise<ToolResult> {
  const result = await runCommand(binary, ["status"]);
  if (result.exitCode !== 0) {
    return formatError(`status failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }
  return formatResponse({ action: "status", output: result.stdout.trim() });
}

async function actionPrint(binary: string, args: Record<string, unknown>): Promise<ToolResult> {
  const imagePath = args.image_path as string;
  if (!imagePath) return formatError("image_path is required for print");

  const cliArgs = ["print", imagePath];

  if (args.threshold !== undefined) {
    const threshold = args.threshold as number;
    if (threshold < 0 || threshold > 255) {
      return formatError("threshold must be between 0 and 255");
    }
    cliArgs.push("--threshold", String(threshold));
  }

  if (args.invert) {
    cliArgs.push("--invert");
  }

  const result = await runCommand(binary, cliArgs);
  if (result.exitCode !== 0) {
    return formatError(`print failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }
  return formatResponse({ action: "print", imagePath, output: result.stdout.trim() });
}

// ── Execute Dispatcher ─────────────────────────────────────

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const action = args.action as Action | undefined;
  if (!action) return formatError(`action is required. Available: ${ACTIONS.join(", ")}`);
  if (!ACTIONS.includes(action)) return formatError(`Unknown action: ${action}. Available: ${ACTIONS.join(", ")}`);

  const config = (ctx.config.integrations as any)?.rs_label ?? {};
  const binary = (config.binary_path as string) || DEFAULT_BINARY;

  try {
    switch (action) {
      case "discover": return actionDiscover(binary);
      case "status":   return actionStatus(binary);
      case "print":    return actionPrint(binary, args);
      default:         return formatError(`Unhandled action: ${action}`);
    }
  } catch (err) {
    return formatError(`rs-label error: ${(err as Error).message}`);
  }
}

// ── Tool Definition ─────────────────────────────────────────

const rsLabelTool: Tool = {
  name: "rs_label",
  description:
    "Control the rs-label label printer via CLI. Discover connected printers, check status, " +
    "and print images to Brother PT-series label printers. " +
    "Actions: discover, status, print. " +
    "Accepts absolute paths or paths relative to the current working directory for image_path.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...ACTIONS],
        description: "Label printer action to perform",
      },
      image_path: {
        type: "string",
        description: "Path to image file to print (absolute or relative to CWD). Required for print action.",
      },
      threshold: {
        type: "number",
        description: "Black/white threshold 0-255 for image conversion (optional, print only)",
      },
      invert: {
        type: "boolean",
        description: "Invert image colors before printing (optional, print only)",
      },
    },
    required: ["action"],
  },
  execute,
};

export default rsLabelTool;
