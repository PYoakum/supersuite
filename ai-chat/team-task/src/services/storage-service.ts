import { mkdirSync, existsSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { config } from "../config";
import type { Task } from "../models/task";

class StorageService {
  private tasks: Task[] = [];
  private idIndex: Map<string, number> = new Map();

  async init(): Promise<void> {
    const dir = dirname(config.dataFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (!existsSync(config.dataFile)) {
      writeFileSync(config.dataFile, "");
      return;
    }

    const raw = readFileSync(config.dataFile, "utf-8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const task: Task = JSON.parse(line);
        const existing = this.idIndex.get(task.id);
        if (existing !== undefined) {
          this.tasks[existing] = task;
        } else {
          this.idIndex.set(task.id, this.tasks.length);
          this.tasks.push(task);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  append(task: Task): void {
    const existing = this.idIndex.get(task.id);
    if (existing !== undefined) {
      this.tasks[existing] = task;
    } else {
      this.idIndex.set(task.id, this.tasks.length);
      this.tasks.push(task);
    }
    appendFileSync(config.dataFile, JSON.stringify(task) + "\n");
  }

  getById(id: string): Task | undefined {
    const idx = this.idIndex.get(id);
    return idx !== undefined ? this.tasks[idx] : undefined;
  }

  getAll(): Task[] {
    return this.tasks.filter(Boolean);
  }

  remove(id: string): boolean {
    const idx = this.idIndex.get(id);
    if (idx === undefined) return false;
    this.tasks[idx] = undefined as any;
    this.idIndex.delete(id);
    this.rewrite();
    return true;
  }

  private rewrite(): void {
    const live = this.tasks.filter(Boolean);
    writeFileSync(config.dataFile, live.map((t) => JSON.stringify(t)).join("\n") + (live.length ? "\n" : ""));
    this.tasks = live;
    this.idIndex.clear();
    live.forEach((t, i) => this.idIndex.set(t.id, i));
  }

  clear(): void {
    this.tasks = [];
    this.idIndex.clear();
    writeFileSync(config.dataFile, "");
  }

  count(): number {
    return this.idIndex.size;
  }
}

export const storageService = new StorageService();
