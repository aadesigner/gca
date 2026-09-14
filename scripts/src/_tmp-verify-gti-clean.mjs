/**
 * Confirm WVWED71K98W309297 photo state after lot-mismatch purge.
 */
import fs from "node:fs";
import pg from "pg";

const VIN = "WVWED71K98W309297";
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
const rows = await c.query(
  `
  SELECT l.source_id, pr.internal_name,
    count(*) FILTER (WHERE p.id IS NOT NULL)::int photos,
    count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
    count(*) FILTER (WHERE p.photo_group IN ('exterior_3d','interior_3d'))::int spin
  FROM listings l
  JOIN providers pr ON pr.id=l.provider_id
  JOIN vehicles v ON v.id=l.vehicle_id
  LEFT JOIN photos p ON p.listing_id=l.id
  WHERE v.vin=$1
  GROUP BY 1,2
`,
  [VIN],
);
console.log(rows.rows);
const left = await c.query(
  `
  SELECT count(*)::int n FROM photos p
  JOIN listings l ON l.id=p.listing_id
  JOIN providers pr ON pr.id=l.provider_id
  WHERE pr.internal_name='import_motor'
    AND l.source_id ~ '^im-\\d{6,}$'
    AND COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) IS NOT NULL
    AND COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) <> (regexp_match(l.source_id, '^im-(\\d{6,})$', 'i'))[1]
`,
);
console.log("remainingMismatches", left.rows[0]);
await c.end();
