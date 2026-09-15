/**
 * Heal WBS3C910XFP708160 (and optional VIN=):
 *  - collapse duplicate Autowini sticky inspection/steering events
 *  - drop BidDrive catalog .jpg rows that already have .avif/.webp twins
 *  - clear mirror-failed so source URL is used until remirror
 */
import pg from "pg";

const VIN = process.env.VIN || "WBS3C910XFP708160";
const base = (process.env.DATABASE_URL || "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip").replace(
  /[?&]sslmode=[^&]+/i,
  "",
);
const c = new pg.Client({ connectionString: `${base}?sslmode=disable` });
await c.connect();

const v = (await c.query(`SELECT id FROM vehicles WHERE vin=$1`, [VIN])).rows[0];
if (!v) {
  console.log("vin_missing", VIN);
  await c.end();
  process.exit(1);
}

const sticky = await c.query(
  `
  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY event_type, md5(coalesce(description,''))
             ORDER BY occurred_at ASC, id ASC
           ) AS rn
    FROM vehicle_events
    WHERE vehicle_id = $1
      AND (
        description ILIKE 'Autowini inspection report uploaded'
        OR description ILIKE 'Steering:%'
        OR description ILIKE 'Odometer reading not actual'
        OR description ILIKE 'VIN / insurance history on file'
        OR metadata::text ILIKE '%"sticky":true%'
        OR metadata::text ILIKE '%inspectionReportUploaded%'
        OR metadata::text ILIKE '%steeringType%'
      )
  )
  DELETE FROM vehicle_events
  WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
  RETURNING id
  `,
  [v.id],
);
console.log("deleted_sticky_dupes", sticky.rowCount);

const jpgDupes = await c.query(
  `
  DELETE FROM photos p
  WHERE p.vehicle_id = $1
    AND p.source_url ~* 'cdn\\.thebidrive\\.com/autowini/catalog/IC[0-9]+/[0-9]+\\.jpe?g'
    AND EXISTS (
      SELECT 1 FROM photos q
      WHERE q.vehicle_id = p.vehicle_id
        AND q.id <> p.id
        AND regexp_replace(lower(q.source_url), '\\.(avif|webp|jpe?g|png)(\\?.*)?$', '')
          = regexp_replace(lower(p.source_url), '\\.(avif|webp|jpe?g|png)(\\?.*)?$', '')
        AND q.source_url ~* '\\.(avif|webp)(\\?|$)'
    )
  RETURNING p.id, left(p.source_url, 100) AS src
  `,
  [v.id],
);
console.log("deleted_jpg_when_avif", jpgDupes.rows);

const cleared = await c.query(
  `
  UPDATE photos
  SET stored_path = NULL
  WHERE vehicle_id = $1
    AND stored_path LIKE 'mirror-failed:%'
  RETURNING id, left(source_url, 100) AS src
  `,
  [v.id],
);
console.log("cleared_mirror_failed", cleared.rows);

const left = await c.query(
  `
  SELECT
    (SELECT count(*) FROM vehicle_events WHERE vehicle_id=$1 AND description ILIKE 'Autowini inspection report uploaded')::int AS insp,
    (SELECT count(*) FROM photos WHERE vehicle_id=$1 AND listing_id IN (
      SELECT l.id FROM listings l JOIN providers p ON p.id=l.provider_id WHERE l.vehicle_id=$1 AND p.internal_name='thebidrive'
    ))::int AS bidrive_photos
  `,
  [v.id],
);
console.log("after", left.rows[0]);
await c.end();
