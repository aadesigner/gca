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

const prodRuntime = process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);

export const pool = new Pool({
  connectionString: pgConnectionString(),
  ssl: pgSsl(),
  // Shared by admin + crawl + public API in one process — avoid tiny default (10)
  // head-of-line blocking under concurrent admin list/stats.
  max: Math.min(
    prodRuntime ? 12 : 40,
    Math.max(8, Number(process.env.DB_POOL_MAX || (prodRuntime ? 12 : 20)) || 12),
  ),
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 8_000) || 8_000,
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000) || 30_000,
  // Kill runaway COUNT/scans so admin /me and healthz stay responsive.
  options: `-c statement_timeout=${Number(process.env.DB_STATEMENT_TIMEOUT_MS || 180_000) || 180_000}`,
  allowExitOnIdle: false,
});
/** Reserved for express-session — never starved by crawl workers. */
export const sessionPool = new Pool({
  connectionString: pgConnectionString(),
  ssl: pgSsl(),
  max: Math.min(8, Math.max(2, Number(process.env.DB_SESSION_POOL_MAX || 5) || 5)),
  connectionTimeoutMillis: Number(process.env.DB_SESSION_CONNECT_TIMEOUT_MS || 15_000) || 15_000,
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000) || 30_000,
  allowExitOnIdle: false,
});
pool.on("error", (err) => {
  console.error(`Postgres pool error: ${err.message}`);
});
sessionPool.on("error", (err) => {
  console.error(`Postgres session pool error: ${err.message}`);
});
export const db = drizzle(pool, { schema });

export { describeDatabaseTarget, formatPgError } from "./pg-ssl";
export * from "./schema";
