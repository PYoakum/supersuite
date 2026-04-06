// Service management subcommands (run before any config/DB init)
const command = process.argv[2];
if (command === "install" || command === "uninstall" || command === "service-status") {
  const { installService, uninstallService, serviceStatus } = await import("./service/index.js");
  if (command === "install") installService();
  else if (command === "uninstall") uninstallService();
  else serviceStatus();
  process.exit(0);
}

import { readFileSync } from "fs";
import { parse } from "smol-toml";
import { initDb } from "./server/db.js";
import { runMigrations } from "./db/migrations.js";
import { startServer } from "./server/index.js";

const configPath = process.env.CONFIG_PATH || "config.toml";
let raw;
try {
  raw = readFileSync(configPath, "utf-8");
} catch {
  console.error(`Failed to read ${configPath}. Copy config.toml.example to config.toml and configure it.`);
  process.exit(1);
}

const config = parse(raw);

const sql = initDb(config.database);

await runMigrations(sql);

startServer(config, sql);
