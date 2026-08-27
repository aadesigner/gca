/**
 * Trim existing VIN galleries to 40 photos, round-robin across listings.
 * Run: pnpm --filter @workspace/scripts run trim-vehicle-photos
 */
import pg from "pg";

await import("../load-env.mjs");

const MAX = 40;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

console.log(`Trimming vehicle photo galleries to ${MAX} (round-robin across listings)…`);

const del = await pool.query(
  `
  WITH per_listing AS (
    SELECT
      id,
      vehicle_id,
      listing_id,
      row_number() OVER (
        PARTITION BY vehicle_id, listing_id
        ORDER BY is_primary DESC, sort_order ASC, id ASC
      ) AS rn_in_listing
    FROM photos
    WHERE vehicle_id IS NOT NULL
  ),
  ranked AS (
    SELECT
      id,
      vehicle_id,
      row_number() OVER (
        PARTITION BY vehicle_id
        ORDER BY rn_in_listing ASC, listing_id NULLS LAST, id ASC
      ) AS keep_rank
    FROM per_listing
  )
  DELETE FROM photos p
  USING ranked r
  WHERE p.id = r.id
    AND r.keep_rank > $1
  RETURNING p.id
  `,
  [MAX],
);

console.log(`Deleted ${del.rowCount ?? 0} excess photos.`);

const reorder = await pool.query(
  `
  WITH ordered AS (
    SELECT
      id,
      (row_number() OVER (
        PARTITION BY vehicle_id
        ORDER BY is_primary DESC, sort_order ASC, id ASC
      ) - 1) AS new_sort,
      (row_number() OVER (
        PARTITION BY vehicle_id
        ORDER BY is_primary DESC, sort_order ASC, id ASC
      ) = 1) AS new_primary
    FROM photos
    WHERE vehicle_id IS NOT NULL
  )
  UPDATE photos p
  SET sort_order = o.new_sort,
      is_primary = o.new_primary
  FROM ordered o
  WHERE p.id = o.id
    AND (p.sort_order IS DISTINCT FROM o.new_sort OR p.is_primary IS DISTINCT FROM o.new_primary)
  `,
);

console.log(`Reordered ${reorder.rowCount ?? 0} photo rows.`);

const check = await pool.query(`
  SELECT count(*)::int AS vins_over
  FROM (
    SELECT vehicle_id
    FROM photos
    WHERE vehicle_id IS NOT NULL
    GROUP BY vehicle_id
    HAVING count(*) > $1
  ) t
`, [MAX]);
console.log("VINs still over cap:", check.rows[0]);

await pool.end();
