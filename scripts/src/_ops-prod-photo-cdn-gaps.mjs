/**
 * Photo CDN coverage for recently synced / Autoplac / Import Motor on prod.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-photo-cdn-gaps.mjs
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
  statement_timeout: 0,
});
await c.connect();

const byProvider = await c.query(`
  SELECT p.internal_name,
    count(DISTINCT l.id)::int AS listings,
    count(ph.id)::int AS photos,
    count(ph.id) FILTER (WHERE ph.stored_path ~* 'imgsv|r2\\.dev')::int AS mirrored,
    count(ph.id) FILTER (WHERE ph.stored_path IS NULL AND ph.source_url ILIKE 'http%')::int AS pending,
    count(ph.id) FILTER (WHERE ph.stored_path ILIKE 'mirror-failed%')::int AS failed,
    count(DISTINCT l.id) FILTER (
      WHERE (SELECT count(*) FROM photos x WHERE x.listing_id=l.id AND x.stored_path ~* 'imgsv|r2\\.dev') = 1
        AND (SELECT count(*) FROM photos x WHERE x.listing_id=l.id) > 1
    )::int AS listings_only_1_cdn_but_more_rows
  FROM providers p
  JOIN listings l ON l.provider_id = p.id
  LEFT JOIN photos ph ON ph.listing_id = l.id
  WHERE p.internal_name IN ('autoplac','import_motor','carpages','ontariocars','bidexport')
  GROUP BY p.internal_name
  ORDER BY p.internal_name
`);
console.log("by_provider", byProvider.rows);

const countries = await c.query(`
  SELECT country, count(*)::int AS n
  FROM listings
  WHERE country ILIKE '%polsk%' OR country ILIKE '%poland%' OR country ILIKE '%pl%'
     OR country ~ '[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]'
  GROUP BY country
  ORDER BY n DESC
  LIMIT 40
`);
console.log("polandish_countries", countries.rows);

const nonEn = await c.query(`
  SELECT country, count(*)::int AS n
  FROM listings
  WHERE country IS NOT NULL AND country <> ''
    AND country !~ '^[A-Za-z .()-]+$'
  GROUP BY country
  ORDER BY n DESC
  LIMIT 30
`);
console.log("non_ascii_countries", nonEn.rows);

const gapSample = await c.query(`
  SELECT p.internal_name, v.vin, l.id AS listing_id,
    (SELECT count(*)::int FROM photos x WHERE x.listing_id=l.id) AS photo_rows,
    (SELECT count(*)::int FROM photos x WHERE x.listing_id=l.id AND x.stored_path ~* 'imgsv|r2\\.dev') AS cdn,
    (SELECT count(*)::int FROM photos x WHERE x.listing_id=l.id AND x.stored_path IS NULL) AS pending
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE p.internal_name IN ('autoplac','import_motor')
    AND EXISTS (SELECT 1 FROM photos x WHERE x.listing_id=l.id AND x.stored_path IS NULL AND x.source_url ILIKE 'http%')
  ORDER BY l.id DESC
  LIMIT 10
`);
console.log("pending_sample", gapSample.rows);
await c.end();
