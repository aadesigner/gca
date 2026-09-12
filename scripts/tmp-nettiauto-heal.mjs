import pg from "pg";
import { readFileSync } from "fs";

const vars = JSON.parse(readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8"));
const m = vars.DATABASE_URL.match(/postgresql:\/\/([^:]+):([^@]+)@/);
const c = new pg.Client({
  host: vars.RAILWAY_TCP_PROXY_DOMAIN,
  port: Number(vars.RAILWAY_TCP_PROXY_PORT),
  user: m[1],
  password: m[2],
  database: "railway",
  ssl: false,
});
await c.connect();

const PLACEHOLDER = "2GNFLFEK1F6224271";
const mode = process.argv[2] || "pause"; // pause | heal

if (mode === "pause") {
  const r = await c.query(
    `
    UPDATE collection_jobs j
    SET status = CASE WHEN j.status = 'running' THEN 'pending' ELSE j.status END,
        job_config = jsonb_set(
          COALESCE(j.job_config::jsonb, '{}'::jsonb),
          '{nextRunAt}',
          to_jsonb((now() + interval '6 hours')::text),
          true
        )::text,
        updated_at = now(),
        error_message = CASE
          WHEN j.status IN ('running','pending') THEN 'paused: waiting for nettiauto-v1.1.0 deploy (placeholder VIN poison)'
          ELSE j.error_message
        END
    FROM providers p
    WHERE j.provider_id = p.id
      AND p.internal_name = 'nettiauto'
      AND j.status IN ('running','pending')
    RETURNING j.id, j.status, j.job_config::json->>'nextRunAt' AS next_run
  `,
  );
  console.log("PAUSED_NETTIAUTO", r.rows);
}

if (mode === "heal") {
  // Remove poisoned nettiauto listings that collapsed onto the search-placeholder VIN.
  const poisoned = await c.query(
    `
    SELECT l.id AS listing_id, l.vehicle_id, l.source_id, l.title
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    WHERE p.internal_name = 'nettiauto'
      AND (l.vin = $1 OR EXISTS (
        SELECT 1 FROM vehicles v WHERE v.id = l.vehicle_id AND v.vin = $1
      ))
    `,
    [PLACEHOLDER],
  );
  console.log("POISONED_COUNT", poisoned.rowCount);

  const ids = poisoned.rows.map((r) => r.listing_id);
  if (ids.length) {
    await c.query(`DELETE FROM photos WHERE listing_id = ANY($1::int[])`, [ids]);
    // observations / raw if present
    try {
      await c.query(`DELETE FROM listing_observations WHERE listing_id = ANY($1::int[])`, [ids]);
    } catch {
      /* optional table */
    }
    try {
      await c.query(`DELETE FROM raw_listings WHERE listing_id = ANY($1::int[])`, [ids]);
    } catch {
      /* optional */
    }
    const del = await c.query(`DELETE FROM listings WHERE id = ANY($1::int[]) RETURNING id`, [ids]);
    console.log("DELETED_LISTINGS", del.rowCount);
  }

  // Also drop nettiauto listings with null/missing vehicle year that look like bad merges
  // (title make doesn't match vehicle make) from the first broken crawl window.
  const mismatch = await c.query(
    `
    SELECT l.id
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    JOIN vehicles v ON v.id = l.vehicle_id
    WHERE p.internal_name = 'nettiauto'
      AND l.created_at > now() - interval '2 days'
      AND v.make IS NOT NULL
      AND l.title IS NOT NULL
      AND lower(split_part(l.title, ' ', 1)) <> lower(split_part(v.make, ' ', 1))
    `,
  );
  const mid = mismatch.rows.map((r) => r.id);
  if (mid.length) {
    await c.query(`DELETE FROM photos WHERE listing_id = ANY($1::int[])`, [mid]);
    const del2 = await c.query(`DELETE FROM listings WHERE id = ANY($1::int[]) RETURNING id`, [mid]);
    console.log("DELETED_MISMATCH", del2.rowCount);
  }

  // Reset nettiauto full job for clean re-crawl with new parser
  const kick = await c.query(
    `
    UPDATE collection_jobs j
    SET status = 'pending',
        crawl_state = NULL,
        pages_processed = 0,
        items_discovered = 0,
        items_processed = 0,
        listings_fetched = 0,
        vins_found = 0,
        vins_new = 0,
        completed_at = NULL,
        error_message = NULL,
        job_config = jsonb_set(
          jsonb_set(
            COALESCE(j.job_config::jsonb, '{}'::jsonb),
            '{nextRunAt}',
            to_jsonb(now()::text),
            true
          ),
          '{skipRecentHours}',
          '0',
          true
        )::text,
        updated_at = now()
    FROM providers p
    WHERE j.provider_id = p.id
      AND p.internal_name = 'nettiauto'
      AND j.job_type = 'full_collection'
      AND j.id = (
        SELECT j2.id FROM collection_jobs j2
        WHERE j2.provider_id = p.id AND j2.job_type = 'full_collection'
        ORDER BY j2.updated_at DESC LIMIT 1
      )
    RETURNING j.id, j.status
  `,
  );
  console.log("KICKED_NETTIAUTO", kick.rows);

  await c.query(
    `UPDATE providers SET parser_version = 'nettiauto-v1.1.0', updated_at = now() WHERE internal_name = 'nettiauto'`,
  );
}

const stats = await c.query(
  `
  SELECT count(*)::int AS listings,
         count(*) FILTER (WHERE l.vin = $1)::int AS placeholder_vin,
         count(DISTINCT l.vin)::int AS distinct_vins
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'nettiauto'
`,
  [PLACEHOLDER],
);
console.log("NETTIAUTO_STATS", stats.rows[0]);
await c.end();
