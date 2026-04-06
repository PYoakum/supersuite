import { join } from "path";

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || "0.0.0.0",
  logFile: process.env.LOG_FILE || join(import.meta.dir, "..", "data", "chat.jsonl"),
  defaultChannel: "general",
  maxMessageLength: 10000,
  defaultPageSize: 100,
  maxPageSize: 500,
};
