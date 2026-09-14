/**
 * Purge Import Motor photos whose IAA/Copart stock ≠ listings.source_id lot (im-{lot}).
 *
 *   DRY_RUN=1 node ./scripts/src/_tmp-purge-im-lot-mismatch.mjs
 *   VIN=WVWED71K98W309297 node ./scripts/src/_tmp-purge-im-lot-mismatch.mjs
 *   node ./scripts/src/_tmp-purge-im-lot-mismatch.mjs
 */
import fs from "node:fs";
import pg from "pg";

const DRY = process.env.DRY_RUN === "1";
const VIN = process.env.VIN?.trim() || null;

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

const vinClause = VIN ? "AND v.vin = $1" : "";
const params = VIN ? [VIN] : [];

const count = await c.query(
  `
WITH bad AS (
  SELECT p.id, v.vin, l.source_id,
    (regexp_match(l.source_id, '^im-(\\d{6,})$', 'i'))[1] AS lot,
    COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) AS stock
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE pr.internal_name = 'import_motor'
    AND l.source_id ~ '^im-\\d{6,}$'
    ${vinClause}
)
SELECT count(*)::int n, count(DISTINCT vin)::int vins
FROM bad
WHERE stock IS NOT NULL AND stock <> lot
`,
  params,
);
console.log("mismatchPhotos", count.rows[0], { DRY, VIN });

if (!DRY) {
  const del = await c.query(
    `
WITH bad AS (
  SELECT p.id
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE pr.internal_name = 'import_motor'
    AND l.source_id ~ '^im-\\d{6,}$'
    ${vinClause}
    AND COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) IS NOT NULL
    AND COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) <> (regexp_match(l.source_id, '^im-(\\d{6,})$', 'i'))[1]
)
DELETE FROM photos p USING bad b WHERE p.id = b.id
RETURNING p.id
`,
    params,
  );
  console.log("purged", del.rowCount);
}

await c.end();
