/**
 * Quick Postgres connectivity check for local setup.
 * Run: pnpm check:db
 */
import pg from "pg";

await import("./load-env.mjs");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is missing. Check your .env file.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });

try {
  await pool.query("SELECT 1");
  console.log("Database connection OK");
  console.log(`Using: ${url.replace(/:[^:@/]+@/, ":****@")}`);
} catch (err) {
  console.error("\nCould not connect to Postgres.\n");
  console.error("Open .env and fix DATABASE_URL with your real username/password.");
  console.error(`Error: ${err instanceof Error ? err.message : err}\n`);
  console.error("Example:");
  console.error("  DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/vdip");
  process.exit(1);
} finally {
  await pool.end();
}
