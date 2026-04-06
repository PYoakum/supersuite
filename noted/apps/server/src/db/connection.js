import postgres from 'postgres';

/** @type {import('postgres').Sql | null} */
let sql = null;

/**
 * Initialize the database connection pool.
 * @param {object} dbConfig - database section of config
 * @returns {import('postgres').Sql}
 */
export function initDb(dbConfig) {
  if (sql) return sql;

  sql = postgres({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.name,
    username: dbConfig.user,
    password: dbConfig.password,
    max: dbConfig.pool_max || 10,
    ssl: dbConfig.ssl ? { rejectUnauthorized: false } : false,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return sql;
}

/**
 * Get the current database connection.
 * Throws if not initialized.
 * @returns {import('postgres').Sql}
 */
export function getDb() {
  if (!sql) throw new Error('Database not initialized. Call initDb() first.');
  return sql;
}

/**
 * Close the database connection pool.
 */
export async function closeDb() {
  if (sql) {
    await sql.end();
    sql = null;
  }
}
