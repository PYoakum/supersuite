import { readdir } from "fs/promises";
import { join } from "path";
import sql from "../server/lib/db.js";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

async function ensureMigrationsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `;
}

async function getApplied() {
  const rows = await sql`SELECT id FROM schema_migrations ORDER BY id`;
  return new Set(rows.map((r) => r.id));
}

async function getMigrationFiles() {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith(".js"))
    .sort();
}

async function migrate() {
  console.log("Running migrations...");
  await ensureMigrationsTable();

  const applied = await getApplied();
  const files = await getMigrationFiles();

  let ran = 0;
  for (const file of files) {
    const id = file.replace(".js", "");
    if (applied.has(id)) continue;

    console.log(`  Applying: ${id}`);
    const mod = await import(join(MIGRATIONS_DIR, file));
    await mod.up(sql);

    await sql`INSERT INTO schema_migrations (id) VALUES (${id})`;
    ran++;
  }

  if (ran === 0) {
    console.log("  All migrations already applied.");
  } else {
    console.log(`  Applied ${ran} migration(s).`);
  }

  await sql.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
