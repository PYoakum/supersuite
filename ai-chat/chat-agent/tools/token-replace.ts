import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// ── Helpers ──────────────────────────────────────────────────

/**
 * Escape special regex characters.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse .yaymap file format (similar to .env).
 * Supports:
 * - KEY=value
 * - KEY="quoted value"
 * - KEY='single quoted value'
 * - # comments
 * - Empty lines
 */
function parseYaymap(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Parse KEY=VALUE
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Handle quoted values
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Handle escape sequences in double-quoted strings
    if (trimmed.slice(eqIndex + 1).trim().startsWith('"')) {
      value = value.replace(/\\n/g, "\n");
      value = value.replace(/\\t/g, "\t");
      value = value.replace(/\\r/g, "\r");
      value = value.replace(/\\\\/g, "\\");
    }

    if (key) {
      map.set(key, value);
    }
  }

  return map;
}

// ── Execute ──────────────────────────────────────────────────

interface ReplacementEntry {
  key: string;
  pattern: string;
  count: number;
}

async function execute(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const mapPath = args.mapPath as string | undefined;
  const inputPath = args.inputPath as string | undefined;
  const outputPath = args.outputPath as string | undefined;
  const inputContent = args.inputContent as string | undefined;
  const delimiter = (args.delimiter as string) ?? "{{}}";
  const caseSensitive = (args.caseSensitive as boolean) ?? true;
  const additionalTokens = (args.additionalTokens as Record<string, string>) ?? {};

  if (!sessionId) {
    return formatError("sessionId is required for sandbox isolation");
  }

  if (!mapPath && Object.keys(additionalTokens).length === 0) {
    return formatError("Either mapPath or additionalTokens is required");
  }

  if (!inputPath && !inputContent) {
    return formatError("Either inputPath or inputContent is required");
  }

  const sandboxPath = await ctx.sandbox.ensureSandbox(sessionId);

  try {
    // Load token map from .yaymap file
    let tokenMap = new Map<string, string>();

    if (mapPath) {
      const absMapPath = join(sandboxPath, mapPath);

      if (!existsSync(absMapPath)) {
        return formatError(`Map file not found: ${mapPath}`);
      }

      const mapContent = await readFile(absMapPath, "utf-8");
      tokenMap = parseYaymap(mapContent);
    }

    // Add/override with additional tokens
    for (const [key, value] of Object.entries(additionalTokens)) {
      tokenMap.set(key, value);
    }

    // Get input content
    let content: string;
    if (inputPath) {
      const absInputPath = join(sandboxPath, inputPath);

      if (!existsSync(absInputPath)) {
        return formatError(`Input file not found: ${inputPath}`);
      }

      content = await readFile(absInputPath, "utf-8");
    } else {
      content = inputContent!;
    }

    // Parse delimiter format (e.g., "{{}}" -> prefix "{{", suffix "}}")
    let prefix: string;
    let suffix: string;
    if (delimiter.length % 2 === 0) {
      const half = delimiter.length / 2;
      prefix = delimiter.slice(0, half);
      suffix = delimiter.slice(half);
    } else {
      // Odd length - use entire string as both prefix and suffix
      prefix = delimiter;
      suffix = delimiter;
    }

    // Perform replacements
    let result = content;
    let replacementCount = 0;
    const replacements: ReplacementEntry[] = [];

    for (const [key, value] of tokenMap) {
      const pattern = `${escapeRegex(prefix)}${escapeRegex(key)}${escapeRegex(suffix)}`;
      const regex = new RegExp(pattern, caseSensitive ? "g" : "gi");
      const matches = result.match(regex);

      if (matches && matches.length > 0) {
        result = result.replace(regex, value);
        replacementCount += matches.length;
        replacements.push({
          key,
          pattern: `${prefix}${key}${suffix}`,
          count: matches.length,
        });
      }
    }

    // Write output if outputPath specified
    let outputWritten = false;
    if (outputPath) {
      const absOutputPath = join(sandboxPath, outputPath);
      await writeFile(absOutputPath, result, "utf-8");
      outputWritten = true;
    } else if (inputPath && !inputContent) {
      // Overwrite input file if no output path and input was a file
      const absInputPath = join(sandboxPath, inputPath);
      await writeFile(absInputPath, result, "utf-8");
      outputWritten = true;
    }

    return formatResponse({
      success: true,
      tokenCount: tokenMap.size,
      replacementCount,
      replacements,
      outputPath: outputPath || inputPath || "(in-memory)",
      outputWritten,
      resultLength: result.length,
      // Include result content if not written to file
      result: outputWritten ? undefined : result,
      sandboxPath,
    });
  } catch (err: any) {
    return formatError(`Token replacement failed: ${err.message}`);
  }
}

// ── Tool Definition ─────────────────────────────────────────

const tokenReplaceTool: Tool = {
  name: "token_replace",
  description:
    "Read a .yaymap file (KEY=value format) and perform string replacements in a target file or content. Tokens in the format {{KEY}} (or custom delimiter) are replaced with their values. Useful for template processing and configuration injection.",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID for sandbox isolation (required)",
      },
      mapPath: {
        type: "string",
        description:
          "Path to .yaymap file containing KEY=value pairs (relative to sandbox)",
      },
      inputPath: {
        type: "string",
        description: "Path to input file to process (relative to sandbox)",
      },
      outputPath: {
        type: "string",
        description:
          "Path for output file (optional, defaults to overwriting input file)",
      },
      inputContent: {
        type: "string",
        description: "Input content as string (alternative to inputPath)",
      },
      delimiter: {
        type: "string",
        default: "{{}}",
        description:
          'Token delimiter format. First half is prefix, second half is suffix. E.g., "{{}}" means {{KEY}}, "$$" means $KEY$',
      },
      caseSensitive: {
        type: "boolean",
        default: true,
        description: "Whether token matching is case-sensitive",
      },
      additionalTokens: {
        type: "object",
        additionalProperties: { type: "string" },
        description:
          "Additional key-value pairs to use (merged with .yaymap file)",
      },
    },
    required: ["sessionId"],
  },
  execute,
};

export default tokenReplaceTool;
