import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { pgConnectionString, pgSsl } from "./pg-ssl";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: pgConnectionString(),
  ssl: pgSsl(),
  // Shared by admin + crawl + public API in one process — avoid tiny default (10)
  // head-of-line blocking under concurrent admin list/stats.
  max: Math.min(40, Math.max(10, Number(process.env.DB_POOL_MAX || 20) || 20)),
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 8_000) || 8_000,
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000) || 30_000,
  // Kill runaway COUNT/scans so admin /me and healthz stay responsive.
  options: `-c statement_timeout=${Number(process.env.DB_STATEMENT_TIMEOUT_MS || 180_000) || 180_000}`,
  allowExitOnIdle: false,
});
pool.on("error", (err) => {
  console.error(`Postgres pool error: ${err.message}`);
});
export const db = drizzle(pool, { schema });

export { describeDatabaseTarget, formatPgError } from "./pg-ssl";
export * from "./schema";
