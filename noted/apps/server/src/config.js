import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'smol-toml';

/**
 * Default configuration values.
 * Any key here can be overridden by config.toml.
 */
const DEFAULTS = {
  server: {
    host: '0.0.0.0',
    port: 3000,
    public_url: 'http://localhost:3000',
  },
  database: {
    host: '127.0.0.1',
    port: 5432,
    name: 'noted',
    user: 'noted',
    password: 'noted',
    pool_max: 10,
    ssl: false,
  },
  auth: {
    cookie_name: 'noted_sid',
    session_max_age: 2592000,
    password_algorithm: 'argon2id',
  },
  storage: {
    media_path: './data/media',
  },
  features: {
    public_sharing: true,
    open_registration: true,
  },
  editor: {
    autosave_debounce_ms: 800,
  },
  slugs: {
    auto_redirects: true,
    max_length: 200,
  },
};

/**
 * Deep merge source into target. Source values override target.
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object'
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Validate required fields and types. Throws on invalid config.
 */
function validate(config) {
  const errors = [];

  if (typeof config.server.port !== 'number' || config.server.port < 1 || config.server.port > 65535) {
    errors.push('server.port must be a number between 1 and 65535');
  }
  if (typeof config.database.host !== 'string' || !config.database.host) {
    errors.push('database.host is required');
  }
  if (typeof config.database.name !== 'string' || !config.database.name) {
    errors.push('database.name is required');
  }
  if (typeof config.database.user !== 'string' || !config.database.user) {
    errors.push('database.user is required');
  }
  if (!['argon2id'].includes(config.auth.password_algorithm)) {
    errors.push('auth.password_algorithm must be "argon2id"');
  }

  if (errors.length > 0) {
    throw new Error(`Config validation errors:\n  - ${errors.join('\n  - ')}`);
  }

  return config;
}

/**
 * Load configuration from a TOML file.
 * Falls back to defaults for missing values.
 *
 * @param {string} [configPath] - path to config.toml (default: ./config.toml)
 * @returns {object} validated config
 */
export function loadConfig(configPath) {
  const filePath = resolve(configPath || process.env.NOTED_CONFIG || 'config.toml');

  let fileConfig = {};
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, 'utf-8');
    fileConfig = parse(raw);
    console.log(`[config] Loaded from ${filePath}`);
  } else {
    console.warn(`[config] No config file at ${filePath}, using defaults`);
  }

  const merged = deepMerge(DEFAULTS, fileConfig);
  return validate(merged);
}
