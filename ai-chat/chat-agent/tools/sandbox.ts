import { mkdir, rm, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, relative, sep } from "path";
import type { SandboxConfig, SandboxStats } from "./types";

const DEFAULTS = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxTotalSize: 100 * 1024 * 1024, // 100MB
  defaultSandboxId: "default",
};

export class SandboxManager {
  readonly baseDir: string;
  readonly maxFileSize: number;
  readonly maxTotalSize: number;
  private defaultSandboxId: string;
  private sandboxSizes = new Map<string, number>();

  constructor(config: SandboxConfig) {
    if (!config.baseDir) throw new Error("baseDir is required for SandboxManager");
    this.baseDir = resolve(config.baseDir);
    this.maxFileSize = config.maxFileSize ?? DEFAULTS.maxFileSize;
    this.maxTotalSize = config.maxTotalSize ?? DEFAULTS.maxTotalSize;
    this.defaultSandboxId = config.defaultSandboxId ?? DEFAULTS.defaultSandboxId;
  }

  getSandboxPath(sessionId?: string): string {
    const id = sessionId ?? this.defaultSandboxId;
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.baseDir, safeId);
  }

  async ensureSandbox(sessionId?: string): Promise<string> {
    const sandboxPath = this.getSandboxPath(sessionId);
    if (!existsSync(sandboxPath)) {
      await mkdir(sandboxPath, { recursive: true, mode: 0o755 });
    }
    return sandboxPath;
  }

  async resolvePath(sessionId: string | undefined, relativePath: string): Promise<string> {
    const sandboxPath = await this.ensureSandbox(sessionId);
    const resolvedPath = resolve(sandboxPath, relativePath);
    if (!this.isPathWithinSandbox(sandboxPath, resolvedPath)) {
      throw Object.assign(new Error(`Path traversal detected: ${relativePath}`), {
        code: "PATH_TRAVERSAL",
      });
    }
    return resolvedPath;
  }

  isPathWithinSandbox(sandboxPath: string, targetPath: string): boolean {
    const rel = relative(sandboxPath, targetPath);
    if (rel.startsWith("..") || rel.startsWith(sep)) return false;
    const normalizedSandbox = sandboxPath.endsWith(sep) ? sandboxPath : sandboxPath + sep;
    const normalizedTarget = targetPath.endsWith(sep) ? targetPath : targetPath + sep;
    return targetPath === sandboxPath || normalizedTarget.startsWith(normalizedSandbox);
  }

  async ensureParentDir(filePath: string): Promise<void> {
    const parentDir = join(filePath, "..");
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }
  }

  validateFileSize(size: number, sessionId?: string): void {
    if (size > this.maxFileSize) {
      throw Object.assign(
        new Error(`File size ${size} bytes exceeds maximum ${this.maxFileSize} bytes`),
        { code: "FILE_SIZE_EXCEEDED" }
      );
    }
    const currentSize = this.sandboxSizes.get(sessionId ?? this.defaultSandboxId) ?? 0;
    if (currentSize + size > this.maxTotalSize) {
      throw Object.assign(
        new Error(
          `Sandbox quota exceeded. Current: ${currentSize}, Adding: ${size}, Max: ${this.maxTotalSize}`
        ),
        { code: "SANDBOX_QUOTA_EXCEEDED" }
      );
    }
  }

  updateSandboxSize(sessionId: string | undefined, sizeDelta: number): void {
    const id = sessionId ?? this.defaultSandboxId;
    const current = this.sandboxSizes.get(id) ?? 0;
    this.sandboxSizes.set(id, Math.max(0, current + sizeDelta));
  }

  async calculateSandboxSize(sessionId?: string): Promise<number> {
    const sandboxPath = this.getSandboxPath(sessionId);
    if (!existsSync(sandboxPath)) return 0;

    let totalSize = 0;
    const walk = async (dirPath: string) => {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = join(dirPath, entry.name);
        if (entry.isDirectory()) await walk(entryPath);
        else if (entry.isFile()) totalSize += (await stat(entryPath)).size;
      }
    };
    await walk(sandboxPath);
    this.sandboxSizes.set(sessionId ?? this.defaultSandboxId, totalSize);
    return totalSize;
  }

  async cleanup(sessionId?: string): Promise<void> {
    const sandboxPath = this.getSandboxPath(sessionId);
    if (existsSync(sandboxPath)) {
      await rm(sandboxPath, { recursive: true, force: true });
    }
    this.sandboxSizes.delete(sessionId ?? this.defaultSandboxId);
  }

  async cleanupAll(): Promise<void> {
    if (existsSync(this.baseDir)) {
      await rm(this.baseDir, { recursive: true, force: true });
    }
    this.sandboxSizes.clear();
  }

  async getStats(): Promise<SandboxStats> {
    const sandboxSizes: Record<string, number> = {};
    let totalSize = 0;
    if (existsSync(this.baseDir)) {
      const entries = await readdir(this.baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const size = await this.calculateSandboxSize(entry.name);
          sandboxSizes[entry.name] = size;
          totalSize += size;
        }
      }
    }
    return {
      totalSandboxes: Object.keys(sandboxSizes).length,
      totalSize,
      sandboxSizes,
      limits: { maxFileSize: this.maxFileSize, maxTotalSize: this.maxTotalSize },
    };
  }

  async listSandboxes(): Promise<string[]> {
    if (!existsSync(this.baseDir)) return [];
    const entries = await readdir(this.baseDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }
}
