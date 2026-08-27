import pg from "pg";

await import("./load-env.mjs");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing in .env");

const parsed = new URL(url.replace(/^postgresql:/, "postgres:"));
const dbName = parsed.pathname.replace(/^\//, "") || "vdip";
parsed.pathname = "/postgres";

const pool = new pg.Pool({ connectionString: parsed.toString() });

try {
  const exists = await pool.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [dbName],
  );
  if (exists.rowCount === 0) {
    await pool.query(`CREATE DATABASE ${dbName}`);
    console.log(`Created database: ${dbName}`);
  } else {
    console.log(`Database already exists: ${dbName}`);
  }
} finally {
  await pool.end();
}
