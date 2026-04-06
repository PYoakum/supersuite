import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import type { ChatMessage, PaginationQuery, SearchQuery } from "../models/message";
import { config } from "../config";

class StorageService {
  private messages: ChatMessage[] = [];
  private idIndex: Map<string, number> = new Map();
  private logPath: string;

  constructor() {
    this.logPath = config.logFile;
  }

  init(): void {
    const dir = dirname(this.logPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (existsSync(this.logPath)) {
      const raw = readFileSync(this.logPath, "utf-8");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as ChatMessage;
          this.idIndex.set(msg.id, this.messages.length);
          this.messages.push(msg);
        } catch {
          // skip malformed lines
        }
      }
      console.log(`[storage] Replayed ${this.messages.length} messages from log`);
    } else {
      console.log("[storage] Starting fresh log");
    }
  }

  append(message: ChatMessage): void {
    this.idIndex.set(message.id, this.messages.length);
    this.messages.push(message);
    appendFileSync(this.logPath, JSON.stringify(message) + "\n");
  }

  getRecent(query: PaginationQuery): ChatMessage[] {
    const limit = Math.min(query.limit || config.defaultPageSize, config.maxPageSize);
    const order = query.order || "desc";

    let slice: ChatMessage[];

    if (query.before) {
      const idx = this.idIndex.get(query.before);
      if (idx === undefined) {
        slice = [];
      } else {
        const start = Math.max(0, idx - limit);
        slice = this.messages.slice(start, idx);
      }
    } else if (query.after) {
      const idx = this.idIndex.get(query.after);
      if (idx === undefined) {
        slice = [];
      } else {
        slice = this.messages.slice(idx + 1, idx + 1 + limit);
      }
    } else {
      // most recent
      slice = this.messages.slice(-limit);
    }

    if (order === "desc") {
      return [...slice].reverse();
    }
    return slice;
  }

  search(query: SearchQuery): { results: ChatMessage[]; total: number } {
    const limit = Math.min(query.limit || config.defaultPageSize, config.maxPageSize);
    const offset = query.offset || 0;
    const qLower = query.q?.toLowerCase();

    let filtered = this.messages;

    if (query.senderId) {
      filtered = filtered.filter((m) => m.senderId === query.senderId);
    }
    if (query.senderType) {
      filtered = filtered.filter((m) => m.senderType === query.senderType);
    }
    if (query.after) {
      const afterTime = new Date(query.after).getTime();
      filtered = filtered.filter((m) => new Date(m.timestamp).getTime() >= afterTime);
    }
    if (query.before) {
      const beforeTime = new Date(query.before).getTime();
      filtered = filtered.filter((m) => new Date(m.timestamp).getTime() <= beforeTime);
    }
    if (qLower) {
      filtered = filtered.filter(
        (m) =>
          m.content.toLowerCase().includes(qLower) ||
          m.displayName.toLowerCase().includes(qLower) ||
          (m.tags && m.tags.some((t) => t.toLowerCase().includes(qLower)))
      );
    }

    const total = filtered.length;
    const results = filtered.slice(offset, offset + limit).reverse();

    return { results, total };
  }

  getById(id: string): ChatMessage | undefined {
    const idx = this.idIndex.get(id);
    return idx !== undefined ? this.messages[idx] : undefined;
  }

  clear(): void {
    this.messages = [];
    this.idIndex.clear();
    writeFileSync(this.logPath, "");
    console.log("[storage] Chat history cleared");
  }

  getStats(): { totalMessages: number; uniqueSenders: number; channels: string[] } {
    const senders = new Set(this.messages.map((m) => m.senderId));
    const channels = [...new Set(this.messages.map((m) => m.channel))];
    return {
      totalMessages: this.messages.length,
      uniqueSenders: senders.size,
      channels,
    };
  }
}

export const storageService = new StorageService();
