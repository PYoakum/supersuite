import sql from "../server/lib/db.js";

async function reset() {
  console.log("Resetting database...");

  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await sql`GRANT ALL ON SCHEMA public TO public`;

  console.log("Database reset complete. Run 'bun run db:migrate' and 'bun run db:seed' next.");
  await sql.end();
}

reset().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
