import postgres from "postgres";

let sql;

export function initDb(dbConfig) {
  sql = postgres({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.name,
    username: dbConfig.user,
    password: dbConfig.password,
    max: dbConfig.max_connections || 10,
  });
  return sql;
}

export function getDb() {
  return sql;
}
