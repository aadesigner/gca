/**
 * Remove duplicate owner_change events (same vehicle + calendar day).
 * Keeps the richest row (Encar sequence text, plate, lowest id).
 *
 * Usage:
 *   node --import ./scripts/load-env.mjs ./scripts/src/backfill-dedupe-owner-events.mjs --dry-run
 *   node --import ./scripts/load-env.mjs ./scripts/src/backfill-dedupe-owner-events.mjs --apply
 *
 * Env: DATABASE_URL or PROD_PG_* for production.
 */
import pg from "pg";

const dryRun = process.argv.includes("--dry-run");
const apply = process.argv.includes("--apply");
if (!dryRun && !apply) {
  console.error("Pass --dry-run or --apply");
  process.exit(1);
}

const client = process.env.PROD_PG_PASSWORD
  ? new pg.Client({
      host: process.env.PROD_PG_HOST ?? "yamanote.proxy.rlwy.net",
      port: Number(process.env.PROD_PG_PORT ?? "15622"),
      user: "postgres",
      password: process.env.PROD_PG_PASSWORD,
      database: "railway",
      ssl: false,
    })
  : new pg.Client({ connectionString: process.env.DATABASE_URL });

await client.connect();

const preview = await client.query(`
  WITH ranked AS (
    SELECT
      id,
      vehicle_id,
      occurred_at::date AS day,
      description,
      ROW_NUMBER() OVER (
        PARTITION BY vehicle_id, (occurred_at AT TIME ZONE 'UTC')::date
        ORDER BY
          CASE WHEN description ~* 'Owner change [0-9]+ of' THEN 0 ELSE 1 END,
          CASE WHEN coalesce(description, '') ~* 'plate|car no' THEN 0 ELSE 1 END,
          length(coalesce(description, '')) DESC,
          id ASC
      ) AS rn
    FROM vehicle_events
    WHERE event_type = 'owner_change'
  )
  SELECT count(*)::int AS dup_rows
  FROM ranked
  WHERE rn > 1
`);
console.log("Duplicate owner_change rows to remove:", preview.rows[0]?.dup_rows ?? 0);

if (apply) {
  const del = await client.query(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY vehicle_id, (occurred_at AT TIME ZONE 'UTC')::date
          ORDER BY
            CASE WHEN description ~* 'Owner change [0-9]+ of' THEN 0 ELSE 1 END,
            CASE WHEN coalesce(description, '') ~* 'plate|car no' THEN 0 ELSE 1 END,
            length(coalesce(description, '')) DESC,
            id ASC
        ) AS rn
      FROM vehicle_events
      WHERE event_type = 'owner_change'
    )
    DELETE FROM vehicle_events ve
    USING ranked r
    WHERE ve.id = r.id AND r.rn > 1
  `);
  console.log("Deleted:", del.rowCount);
} else {
  console.log("Dry run — no rows deleted.");
}

await client.end();
