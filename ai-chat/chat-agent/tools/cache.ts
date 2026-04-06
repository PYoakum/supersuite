import { createHash } from "crypto";

interface CacheEntry {
  result: string;
  isError: boolean;
  cachedAt: number;
  hitCount: number;
}

/**
 * LRU cache for tool results. Keyed by tool name + input hash.
 * Entries expire after ttlMs and the cache is bounded by maxEntries.
 */
export class ToolCache {
  private cache = new Map<string, CacheEntry>();
  private maxEntries: number;
  private ttlMs: number;

  constructor(maxEntries = 100, ttlMs = 300_000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  private makeKey(toolName: string, input: Record<string, unknown>): string {
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex")
      .slice(0, 16);
    return `${toolName}:${hash}`;
  }

  get(toolName: string, input: Record<string, unknown>): { result: string; isError: boolean } | null {
    const key = this.makeKey(toolName, input);
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    entry.hitCount++;
    // Move to end for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);
    return { result: entry.result, isError: entry.isError };
  }

  set(toolName: string, input: Record<string, unknown>, result: string, isError: boolean): void {
    // Don't cache errors
    if (isError) return;

    const key = this.makeKey(toolName, input);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }

    this.cache.set(key, {
      result,
      isError,
      cachedAt: Date.now(),
      hitCount: 0,
    });
  }

  /**
   * Check if a tool's results should be cached.
   * Read-only tools are cacheable; mutating tools are not.
   */
  static isCacheable(toolName: string, input: Record<string, unknown>): boolean {
    // Tools that read or query are cacheable
    const readOnlyTools = ["http_request", "read_file"];
    if (readOnlyTools.includes(toolName)) return true;

    // code_editor: only read/list/stat/explore are cacheable
    if (toolName === "code_editor") {
      const op = input.operation as string | undefined;
      return ["read", "list", "stat", "explore"].includes(op ?? "");
    }

    return false;
  }

  get stats() {
    let totalHits = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hitCount;
    }
    return {
      entries: this.cache.size,
      totalHits,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
    };
  }

  clear(): void {
    this.cache.clear();
  }
}
