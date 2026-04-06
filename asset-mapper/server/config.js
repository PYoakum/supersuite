// server/config.js — Load and merge TOML config files
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import TOML from 'toml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '../config');

function loadToml(filename) {
  try {
    const raw = readFileSync(join(CONFIG_DIR, filename), 'utf8');
    return TOML.parse(raw);
  } catch (err) {
    console.error(`[config] Failed to load ${filename}:`, err.message);
    return {};
  }
}

const app    = loadToml('app.toml');
const theme  = loadToml('theme.toml');
const fields = loadToml('fields.toml');

export const config = {
  port:     app?.server?.port    ?? 3000,
  baseUrl:  app?.server?.base_url ?? 'http://localhost:3000',
  logLevel: app?.server?.log_level ?? 'info',
  dbPath:   app?.database?.path   ?? './data/asset-map.db',
  auth:     app?.auth             ?? { mode: 'none' },
  barcode:  app?.barcode          ?? { format: 'qr', prefix: 'asset://device/' },
  theme,
  fields,
};

export default config;
