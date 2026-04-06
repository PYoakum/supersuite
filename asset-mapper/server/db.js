// server/db.js — SQLite using Bun's built-in bun:sqlite
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import config from './config.js';
import logger from './util/logger.js';

const dbPath = resolve(config.dbPath);
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

// Enable WAL for better concurrency
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

logger.info(`[db] Connected to ${dbPath}`);

export default db;
