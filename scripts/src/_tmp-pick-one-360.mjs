/**
 * Pick one trustworthy IM VIN with exterior+interior 360 and decent gallery.
 */
import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => {
  const v = vars[n];
  return v && typeof v === "object" && "value" in v ? v.value : v;
};
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
await c.query("SET statement_timeout = 60000");

const rows = await c.query(`
WITH cand AS (
  SELECT v.vin, v.make, v.model, v.year, l.source_id, l.id AS listing_id,
    count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
    count(*) FILTER (WHERE p.photo_group='exterior_3d')::int ext,
    count(*) FILTER (WHERE p.photo_group='interior_3d')::int int,
    count(*) FILTER (WHERE p.photo_group='exterior_3d' AND p.source_url ILIKE '%ThreeSixtyImageRetriever%')::int ext_retriever,
    count(*) FILTER (WHERE p.photo_group='exterior_3d' AND p.source_url ILIKE '%~STP~%')::int ext_stp,
    count(DISTINCT COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, '/iaai/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ))::int stocks,
    max(p.created_at) last_photo
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE pr.internal_name = 'import_motor'
    AND p.created_at > NOW() - interval '6 hours'
  GROUP BY 1,2,3,4,5,6
  HAVING count(*) FILTER (WHERE p.photo_group='exterior_3d') >= 12
     AND count(*) FILTER (WHERE p.photo_group='interior_3d') >= 1
     AND count(*) FILTER (WHERE p.photo_group='gallery') >= 8
     AND count(*) FILTER (WHERE p.photo_group='exterior_3d' AND p.source_url ILIKE '%ThreeSixtyImageRetriever%') >= 12
  ORDER BY max(p.created_at) DESC
  LIMIT 15
)
SELECT * FROM cand
WHERE stocks <= 2
ORDER BY last_photo DESC
LIMIT 5
`);
console.log("recent360", rows.rows);

if (!rows.rows.length) {
  const fallback = await c.query(`
  SELECT v.vin, v.make, v.model, v.year, l.source_id,
    count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
    count(*) FILTER (WHERE p.photo_group='exterior_3d')::int ext,
    count(*) FILTER (WHERE p.photo_group='interior_3d')::int int,
    count(*) FILTER (WHERE p.source_url ILIKE '%ThreeSixtyImageRetriever%')::int retriever,
    max(p.created_at) last_photo
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE pr.internal_name = 'import_motor'
  GROUP BY 1,2,3,4,5
  HAVING count(*) FILTER (WHERE p.photo_group='exterior_3d' AND p.source_url ILIKE '%ThreeSixtyImageRetriever%') >= 16
     AND count(*) FILTER (WHERE p.photo_group='interior_3d') >= 1
     AND count(*) FILTER (WHERE p.photo_group='gallery') >= 10
  ORDER BY max(p.created_at) DESC
  LIMIT 5
  `);
  console.log("fallback360", fallback.rows);
}

if (rows.rows[0]) {
  const vin = rows.rows[0].vin;
  const sample = await c.query(
    `
    SELECT photo_group, sort_order, left(source_url, 140) src
    FROM photos p
    JOIN vehicles v ON v.id = p.vehicle_id
    WHERE v.vin = $1
    ORDER BY CASE photo_group WHEN 'gallery' THEN 0 WHEN 'exterior_3d' THEN 1 ELSE 2 END, sort_order
    LIMIT 8
  `,
    [vin],
  );
  console.log("sample", sample.rows);
}
await c.end();
