/**
 * SandboxGuard — deterministic enforcement layer that validates tool arguments
 * contain no path references outside the sandbox, regardless of what the
 * individual tool implementation does.
 *
 * This is a defense-in-depth measure. Even if a tool has a bug that bypasses
 * its own path validation, the guard will catch it before execution.
 */

import { resolve, relative, sep } from "path";
import { log } from "../logger";

// Keys in tool arguments that commonly hold paths
const PATH_ARG_KEYS = [
  "path", "filePath", "file_path", "file", "filename",
  "directory", "dir", "cwd", "workingDir", "working_dir",
  "outputPath", "output_path", "output", "destination",
  "inputPath", "input_path", "source", "src",
  "entryPoint", "entry_point", "script", "scriptPath",
  "dbPath", "db_path", "database",
  "target", "targetPath", "projectDir",
  "filename", "outputFilename", "name",
];

// Keys in arguments that hold executable code — not paths, skip
const CODE_ARG_KEYS = ["code", "content", "body", "text", "query", "sql", "command"];

// Patterns that indicate absolute path escape attempts
const ESCAPE_PATTERNS = [
  /\.\.\//,           // parent directory traversal
  /\.\.\\/,           // Windows-style parent traversal
  /^\/(?!$)/,         // absolute paths (except bare "/")
  /^[A-Z]:\\/i,       // Windows absolute paths
  /^~\//,             // home directory expansion
  /\$\{/,             // variable expansion
  /\$\(/,             // command substitution
];

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

export function validateToolArgs(
  toolName: string,
  args: Record<string, unknown>,
  sandboxRoot: string,
): GuardResult {
  for (const [key, value] of Object.entries(args)) {
    // Skip non-path arguments
    if (CODE_ARG_KEYS.includes(key)) continue;

    // Check string values that look like paths
    if (typeof value === "string" && isPathLikeKey(key)) {
      const check = validatePath(value, sandboxRoot);
      if (!check.allowed) {
        log.warn(`SandboxGuard blocked ${toolName}.${key}: ${check.reason}`);
        return { allowed: false, reason: `Argument '${key}' rejected: ${check.reason}` };
      }
    }

    // Check arrays of strings (e.g., file lists)
    if (Array.isArray(value) && isPathLikeKey(key)) {
      for (const item of value) {
        if (typeof item === "string") {
          const check = validatePath(item, sandboxRoot);
          if (!check.allowed) {
            log.warn(`SandboxGuard blocked ${toolName}.${key}[]: ${check.reason}`);
            return { allowed: false, reason: `Argument '${key}' contains blocked path: ${check.reason}` };
          }
        }
      }
    }

    // Deep-check nested objects for path-like keys
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = validateToolArgs(toolName, value as Record<string, unknown>, sandboxRoot);
      if (!nested.allowed) return nested;
    }
  }

  return { allowed: true };
}

function isPathLikeKey(key: string): boolean {
  const lower = key.toLowerCase();
  return PATH_ARG_KEYS.some(p => lower === p.toLowerCase()) ||
    lower.endsWith("path") ||
    lower.endsWith("dir") ||
    lower.endsWith("file") ||
    lower.endsWith("directory");
}

function validatePath(value: string, sandboxRoot: string): GuardResult {
  // Empty string is fine
  if (!value.trim()) return { allowed: true };

  // Check for escape patterns
  for (const pattern of ESCAPE_PATTERNS) {
    if (pattern.test(value)) {
      // Resolve the path relative to sandbox and verify it stays inside
      const resolved = resolve(sandboxRoot, value);
      const rel = relative(sandboxRoot, resolved);

      if (rel.startsWith("..") || rel.startsWith(sep)) {
        return {
          allowed: false,
          reason: `Path '${value}' resolves outside sandbox (${resolved})`,
        };
      }
    }
  }

  // Even for relative paths, verify the resolved path is within sandbox
  const resolved = resolve(sandboxRoot, value);
  const rel = relative(sandboxRoot, resolved);
  if (rel.startsWith("..") || rel.startsWith(sep)) {
    return {
      allowed: false,
      reason: `Path '${value}' escapes sandbox boundary`,
    };
  }

  return { allowed: true };
}

/**
 * Validate that a command string doesn't contain obvious sandbox escapes.
 * Used for bash/shell command arguments.
 */
export function validateCommand(command: string, sandboxRoot: string): GuardResult {
  // Check for absolute path references outside sandbox
  const absolutePathRe = /(?:^|\s|[;|&])\s*(\/(?:etc|usr|var|tmp|home|root|opt|proc|sys|dev|boot|bin|sbin|lib)\b)/gi;
  let match;
  while ((match = absolutePathRe.exec(command)) !== null) {
    const path = match[1];
    const resolved = resolve(path);
    const rel = relative(sandboxRoot, resolved);
    if (rel.startsWith("..") || rel.startsWith(sep)) {
      return {
        allowed: false,
        reason: `Command references system path: ${path}`,
      };
    }
  }

  return { allowed: true };
}
