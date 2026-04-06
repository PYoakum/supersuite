import { readFile } from "fs/promises";
import { mkdir } from "fs/promises";
import { parse } from "smol-toml";
import { connect, runMigrations } from "./lib/database.js";
import { createServer } from "./server/index.js";
import { buildTemplate } from "./web/template.js";

// Load config
let configText;
try {
  configText = await readFile("config.toml", "utf-8");
} catch {
  console.error("config.toml not found. Copy config.toml.example to config.toml and edit it.");
  process.exit(1);
}
const config = parse(configText);

// Defaults
config.server = { port: 3000, host: "0.0.0.0", ...config.server };
config.database = { host: "localhost", port: 5432, database: "warehouse", user: "warehouse", password: "warehouse", ...config.database };
config.storage = { uploads_dir: "data/uploads", max_upload_mb: 20, ...config.storage };
config.auth = { jwt_secret: "change-me", jwt_refresh_secret: "change-me-refresh", jwt_expiry: "15m", jwt_refresh_expiry: "7d", bcrypt_rounds: 12, ...config.auth };

// Ensure data directories
await mkdir(config.storage.uploads_dir, { recursive: true });
await mkdir(config.storage.uploads_dir + "/photos", { recursive: true });
await mkdir(config.storage.uploads_dir + "/barcodes", { recursive: true });
await mkdir(config.storage.uploads_dir + "/thumbnails", { recursive: true });

// Database
console.log("Connecting to database...");
const sql = connect(config);

console.log("Running migrations...");
await runMigrations(sql);

// Build SPA template
const spaHtml = buildTemplate();

// Start server
const server = createServer(config, sql, spaHtml);
console.log(`Warehouse running at http://${server.hostname}:${server.port}`);
