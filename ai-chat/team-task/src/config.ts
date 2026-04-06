import { join } from "path";

export const config = {
  port: Number(process.env.PORT) || 3001,
  host: process.env.HOST || "0.0.0.0",
  dataFile: process.env.DATA_FILE || join(import.meta.dir, "..", "data", "tasks.jsonl"),
  chatUrl: process.env.CHAT_URL || "http://localhost:3000",
  chatSenderId: process.env.CHAT_SENDER_ID || "task-manager",
  chatDisplayName: process.env.CHAT_DISPLAY_NAME || "Task Manager",
  chatChannel: process.env.CHAT_CHANNEL || "general",
  notifyOnChange: process.env.NOTIFY_ON_CHANGE === "true",
  maxTitleLength: 200,
  maxDescriptionLength: 5000,
  defaultPageSize: 50,
  maxPageSize: 500,
};
