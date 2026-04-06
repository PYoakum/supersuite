import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from '../config';

const sql = postgres(config.db.url);

async function migrate() {
  const migrationPath = join(import.meta.dir, 'migrations', '001_initial_schema.sql');
  const migration = readFileSync(migrationPath, 'utf-8');

  console.log('Running migrations...');
  await sql.unsafe(migration);
  console.log('Migrations complete.');

  await sql.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
