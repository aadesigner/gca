import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function pgSsl(): false | { rejectUnauthorized: boolean } | undefined {
  const url = process.env.DATABASE_URL ?? "";
  if (/sslmode=disable/i.test(url)) return false;
  if (process.env.NODE_ENV === "production") {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: pgSsl(),
  // Shared by admin + crawl + public API in one process — avoid tiny default (10)
  // head-of-line blocking under concurrent admin list/stats.
  max: Math.min(40, Math.max(10, Number(process.env.DB_POOL_MAX || 20) || 20)),
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 8_000) || 8_000,
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000) || 30_000,
  allowExitOnIdle: false,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
