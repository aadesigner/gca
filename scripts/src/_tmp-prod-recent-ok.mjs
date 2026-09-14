/**
 * Fast prod recheck after publish.
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

const recent = await c.query(`
WITH recent AS (
  SELECT p.source_url, l.source_id, p.created_at
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  WHERE pr.internal_name = 'import_motor'
    AND p.created_at > NOW() - interval '30 minutes'
  ORDER BY p.created_at DESC
  LIMIT 1500
)
SELECT count(*)::int n,
  count(*) FILTER (
    WHERE COALESCE(
      (regexp_match(source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) IS NOT NULL
    AND source_id ~ '^im-\\d{6,}$'
    AND COALESCE(
      (regexp_match(source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) = (regexp_match(source_id, '^im-(\\d{6,})$', 'i'))[1]
  )::int matched,
  count(*) FILTER (
    WHERE COALESCE(
      (regexp_match(source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) IS NOT NULL
    AND source_id ~ '^im-\\d{6,}$'
    AND COALESCE(
      (regexp_match(source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) <> (regexp_match(source_id, '^im-(\\d{6,})$', 'i'))[1]
  )::int mismatched
FROM recent
`);
console.log("prodRecent30m", recent.rows[0]);

const gti = await c.query(`
  SELECT count(*)::int photos FROM photos p
  JOIN vehicles v ON v.id = p.vehicle_id WHERE v.vin = 'WVWED71K98W309297'
`);
console.log("gtiPhotos", gti.rows[0]);

const fleet = await c.query(`
  SELECT count(*) FILTER (WHERE status='running')::int running,
         count(*) FILTER (WHERE status='running' AND updated_at < NOW()-interval '20 minutes')::int quiet20
  FROM collection_jobs
`);
console.log("fleet", fleet.rows[0]);
await c.end();
