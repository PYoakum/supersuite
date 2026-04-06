import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { initDb, closeDb } from './connection.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

/**
 * Ensure the migrations tracking table exists.
 */
async function ensureMigrationsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

/**
 * Get list of already-applied migration names.
 */
async function getAppliedMigrations(sql) {
  const rows = await sql`SELECT name FROM _migrations ORDER BY id`;
  return new Set(rows.map((r) => r.name));
}

/**
 * Run all pending migrations in order.
 */
export async function runMigrations(sql) {
  await ensureMigrationsTable(sql);
  const applied = await getAppliedMigrations(sql);

  // Read migration files, sorted by filename
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const filePath = join(MIGRATIONS_DIR, file);
    const content = readFileSync(filePath, 'utf-8');

    console.log(`[migrate] Applying ${file}...`);

    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO _migrations (name) VALUES (${file})`;
    });

    count++;
  }

  if (count === 0) {
    console.log('[migrate] All migrations already applied.');
  } else {
    console.log(`[migrate] Applied ${count} migration(s).`);
  }
}

/**
 * CLI entrypoint: load config, connect, migrate, exit.
 * Only runs when this file is executed directly (not imported).
 */
const isCLI = process.argv[1] && (
  process.argv[1].endsWith('migrate.js') ||
  process.argv[1].endsWith('db/migrate')
);

if (isCLI) {
  (async () => {
    try {
      const config = loadConfig();
      const sql = initDb(config.database);
      await runMigrations(sql);
    } catch (err) {
      console.error('[migrate] Error:', err.message);
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  })();
}
