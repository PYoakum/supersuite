import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://claude@localhost:5432/nonprofit_crm";

const sql = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  transform: {
    undefined: null,
  },
});

export default sql;
