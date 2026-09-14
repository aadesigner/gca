import fs from "node:fs";
import pg from "pg";
const VIN = "JTDKDTB34C1517287";
const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => { const v = vars[n]; return v && typeof v === "object" && "value" in v ? v.value : v; };
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// Purge fake probed 360 on this VIN
const del = await c.query(`
  DELETE FROM photos p USING vehicles v
  WHERE p.vehicle_id = v.id AND v.vin = $1
    AND p.photo_group IN ('exterior_3d','interior_3d')
  RETURNING p.id
`, [VIN]);
console.log("purgedPrius360", del.rowCount);

// Broader: IM listings whose gallery is ONLY cars*.import-motor.com (no vis.iaai gallery stills)
// and have probed ThreeSixtyImageRetriever 360 — likely fake attach without page viewer.
const broad = await c.query(`
WITH im_listings AS (
  SELECT l.id AS listing_id, v.vin
  FROM listings l
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE pr.internal_name = 'import_motor'
    AND EXISTS (
      SELECT 1 FROM photos p WHERE p.listing_id = l.id AND p.photo_group IN ('exterior_3d','interior_3d')
        AND p.source_url ILIKE '%ThreeSixtyImageRetriever%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM photos g WHERE g.listing_id = l.id AND g.photo_group = 'gallery'
        AND (
          g.source_url ILIKE '%vis.iaai.com%'
          OR g.source_url ILIKE '%mediaretriever.iaai.com%'
          OR g.source_url ILIKE '%cs.copart.com%'
        )
    )
    AND EXISTS (
      SELECT 1 FROM photos g WHERE g.listing_id = l.id AND g.photo_group = 'gallery'
        AND g.source_url ILIKE '%import-motor.com%'
    )
)
SELECT count(*)::int listings FROM im_listings
`);
console.log("suspectFakeSpinListings", broad.rows[0]);

const delBroad = await c.query(`
WITH im_listings AS (
  SELECT l.id AS listing_id
  FROM listings l
  JOIN providers pr ON pr.id = l.provider_id
  WHERE pr.internal_name = 'import_motor'
    AND EXISTS (
      SELECT 1 FROM photos p WHERE p.listing_id = l.id AND p.photo_group IN ('exterior_3d','interior_3d')
        AND p.source_url ILIKE '%ThreeSixtyImageRetriever%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM photos g WHERE g.listing_id = l.id AND g.photo_group = 'gallery'
        AND (
          g.source_url ILIKE '%vis.iaai.com%'
          OR g.source_url ILIKE '%mediaretriever.iaai.com%'
          OR g.source_url ILIKE '%cs.copart.com%'
        )
    )
    AND EXISTS (
      SELECT 1 FROM photos g WHERE g.listing_id = l.id AND g.photo_group = 'gallery'
        AND g.source_url ILIKE '%import-motor.com%'
    )
)
DELETE FROM photos p
USING im_listings i
WHERE p.listing_id = i.listing_id
  AND p.photo_group IN ('exterior_3d','interior_3d')
RETURNING p.id
`);
console.log("purgedSuspectFakeSpinFrames", delBroad.rowCount);

// Real 360: gallery has vis.iaai S0 stills + matching exterior stock + decent gallery count
const real = await c.query(`
WITH cand AS (
  SELECT v.id, v.vin, v.make, v.model, v.year,
    count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
    count(*) FILTER (WHERE p.photo_group='exterior_3d')::int ext,
    count(*) FILTER (WHERE p.photo_group='interior_3d')::int int,
    count(*) FILTER (WHERE p.photo_group='gallery' AND p.source_url ILIKE '%vis.iaai.com%')::int gal_iaa,
    count(*) FILTER (WHERE p.photo_group='gallery' AND p.source_url ILIKE '%import-motor.com%')::int gal_im,
    count(DISTINCT COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})(?:%7E|~)SID', 'i'))[1],
      (regexp_match(p.source_url, '/iaai/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    )) FILTER (WHERE p.photo_group IN ('gallery','exterior_3d','interior_3d'))::int stocks
  FROM vehicles v
  JOIN photos p ON p.vehicle_id = v.id
  GROUP BY v.id
  HAVING count(*) FILTER (WHERE p.photo_group='gallery' AND p.source_url ILIKE '%vis.iaai.com%') >= 8
     AND count(*) FILTER (WHERE p.photo_group='exterior_3d') >= 10
     AND count(*) FILTER (WHERE p.photo_group='interior_3d') >= 8
     AND count(DISTINCT COALESCE(
       (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
       (regexp_match(p.source_url, 'imageKeys=(\\d{6,})(?:%7E|~)SID', 'i'))[1],
       (regexp_match(p.source_url, '/iaai/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
     )) FILTER (WHERE p.photo_group IN ('gallery','exterior_3d','interior_3d')) = 1
)
SELECT * FROM cand ORDER BY gal DESC, ext DESC LIMIT 8
`);
console.log("real360", real.rows);
await c.end();
