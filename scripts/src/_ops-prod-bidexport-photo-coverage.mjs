/**
 * Count BidExport listings missing CDN photos on prod.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-bidexport-photo-coverage.mjs
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

const c = new pg.Client({ connectionString: loadProdUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`
  SELECT
    count(*)::int AS listings,
    count(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM photos ph
        WHERE ph.listing_id = l.id AND ph.stored_path ~* 'imgsv|r2\\.dev'
      )
    )::int AS with_cdn,
    count(*) FILTER (
      WHERE EXISTS (SELECT 1 FROM photos ph WHERE ph.listing_id = l.id)
        AND NOT EXISTS (
          SELECT 1 FROM photos ph
          WHERE ph.listing_id = l.id AND ph.stored_path ~* 'imgsv|r2\\.dev'
        )
    )::int AS photos_but_no_cdn,
    count(*) FILTER (
      WHERE NOT EXISTS (SELECT 1 FROM photos ph WHERE ph.listing_id = l.id)
    )::int AS zero_photos
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'bidexport'
`);
console.log(r.rows[0]);
await c.end();
