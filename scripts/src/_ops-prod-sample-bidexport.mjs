/**
 * Sample BidExport photo + event health on prod.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-sample-bidexport.mjs
 */
import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const c = new pg.Client({
  connectionString: loadProdUrl(),
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const samples = await c.query(`
  SELECT v.vin, left(l.source_url,80) AS url,
    (SELECT count(*)::int FROM photos ph WHERE ph.listing_id=l.id AND ph.stored_path IS NULL AND ph.source_url ILIKE 'http%') AS pending,
    (SELECT count(*)::int FROM photos ph WHERE ph.listing_id=l.id AND ph.stored_path ~* 'imgsv') AS mirrored,
    (SELECT count(*)::int FROM photos ph WHERE ph.listing_id=l.id) AS photos,
    (SELECT count(*)::int FROM vehicle_events ve WHERE ve.vehicle_id=v.id AND coalesce(ve.metadata::jsonb->>'field','') = '') AS timelineish,
    (SELECT count(*)::int FROM vehicle_events ve WHERE ve.vehicle_id=v.id AND coalesce(ve.metadata::jsonb->>'field','') <> '') AS extras
  FROM listings l
  JOIN providers p ON p.id=l.provider_id
  JOIN vehicles v ON v.id=l.vehicle_id
  WHERE p.internal_name='bidexport'
  ORDER BY l.id DESC
  LIMIT 5
`);
console.log("samples", samples.rows);

const pendingHosts = await c.query(`
  SELECT
    CASE
      WHEN ph.source_url ILIKE '%vis.iaai.com%' THEN 'iaai'
      WHEN ph.source_url ILIKE '%copart%' THEN 'copart'
      WHEN ph.source_url ILIKE '%bidexport%' THEN 'bidexport'
      ELSE left(substring(ph.source_url from 'https?://([^/]+)'), 40)
    END AS host,
    count(*)::int AS n,
    count(*) FILTER (WHERE ph.stored_path IS NULL)::int AS pending
  FROM photos ph
  JOIN listings l ON l.id=ph.listing_id
  JOIN providers p ON p.id=l.provider_id
  WHERE p.internal_name='bidexport'
  GROUP BY 1
  ORDER BY n DESC
  LIMIT 10
`);
console.log("hosts", pendingHosts.rows);

const pendingSample = await c.query(`
  SELECT ph.id, left(ph.source_url,120) AS url, ph.stored_path
  FROM photos ph
  JOIN listings l ON l.id=ph.listing_id
  JOIN providers p ON p.id=l.provider_id
  WHERE p.internal_name='bidexport' AND ph.stored_path IS NULL AND ph.source_url ILIKE 'http%'
  ORDER BY ph.id DESC
  LIMIT 3
`);
console.log("pending_urls", pendingSample.rows);
await c.end();
