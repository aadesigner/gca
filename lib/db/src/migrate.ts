/**
 * Run all pending Drizzle migrations.
 *
 * Safe to call on every startup — Drizzle tracks applied migrations in
 * the `drizzle.__drizzle_migrations` table and skips already-applied ones.
 *
 * Migration folder resolution (in priority order):
 *  1. DRIZZLE_MIGRATIONS_DIR env var — absolute path, for production.
 *  2. Relative to the running module's directory (works for both the bundled
 *     api-server and tsx source runs, because build.mjs copies migrations
 *     to dist/migrations/).
 *
 * Bootstrap mode: if application tables already exist (created by
 * `drizzle push`) but no migration journal entries exist, each migration's
 * SHA-256 hash is stamped as applied without re-running the SQL.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "path";
import crypto from "crypto";
import fs from "fs/promises";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

function getMigrationsFolder(): string {
  if (process.env.DRIZZLE_MIGRATIONS_DIR) {
    return process.env.DRIZZLE_MIGRATIONS_DIR;
  }

  // At runtime inside the bundled server, globalThis.__dirname is set by the
  // build banner to the dist/ directory, which is where build.mjs copies
  // the migrations folder. When running via tsx directly, import.meta.url
  // points to lib/db/src/migrate.ts so ../migrations → lib/db/migrations/.
  const runtimeDir =
    typeof globalThis.__dirname === "string"
      ? (globalThis.__dirname as string)
      : path.dirname(fileURLToPath(import.meta.url));

  // Prefer same-dir/migrations (bundled), fall back to ../migrations (tsx source run).
  const bundlePath = path.join(runtimeDir, "migrations");
  if (existsSync(path.join(bundlePath, "meta", "_journal.json"))) {
    return bundlePath;
  }
  return path.join(runtimeDir, "../migrations");
}

export async function runMigrations(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const MIGRATIONS_FOLDER = getMigrationsFolder();

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const db = drizzle(client);

    // Does the drizzle migrations tracking table have any entries?
    const { rows: schemaRows } = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
    `);
    const journalTableExists = schemaRows.length > 0;

    let journalIsEmpty = true;
    if (journalTableExists) {
      const { rows } = await client.query(
        `SELECT COUNT(*) AS c FROM drizzle.__drizzle_migrations`,
      );
      journalIsEmpty = Number(rows[0]?.c ?? 0) === 0;
    }

    const needsBootstrap = !journalTableExists || journalIsEmpty;

    if (needsBootstrap) {
      // Check whether application tables already exist (set up via drizzle push).
      const { rows: appRows } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'admin_users'
      `);

      if (appRows.length > 0) {
        // Tables exist without tracked migrations — bootstrap the journal.
        if (!journalTableExists) {
          await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
          await client.query(`
            CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
              id SERIAL PRIMARY KEY,
              hash text NOT NULL,
              created_at bigint
            )
          `);
        }

        const journalRaw = await fs.readFile(
          path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"),
          "utf-8",
        );
        const journal = JSON.parse(journalRaw) as {
          entries: Array<{ idx: number; when: number; tag: string }>;
        };

        for (const entry of journal.entries) {
          const sqlContent = await fs.readFile(
            path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
            "utf-8",
          );
          const hash = crypto.createHash("sha256").update(sqlContent).digest("hex");
          const { rows: existing } = await client.query(
            `SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1`,
            [hash],
          );
          if (existing.length === 0) {
            await client.query(
              `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
              [hash, entry.when],
            );
          }
        }
        console.log("Bootstrapped migration journal for existing database.");
      }
    }

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}
