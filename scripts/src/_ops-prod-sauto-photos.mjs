import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const c = new pg.Client({ connectionString: loadProdUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();

const stats = await c.query(`
SELECT
  count(DISTINCT l.id)::int AS listings,
  count(ph.id)::int AS photos,
  count(ph.id) FILTER (WHERE ph.stored_path IS NOT NULL AND btrim(ph.stored_path) <> '')::int AS with_stored,
  count(ph.id) FILTER (WHERE ph.stored_path ~* 'imgsv|r2\\.dev')::int AS cdn_like,
  count(DISTINCT l.id) FILTER (WHERE EXISTS (SELECT 1 FROM photos p2 WHERE p2.listing_id=l.id))::int AS listings_with_photo_row,
  count(DISTINCT l.id) FILTER (WHERE EXISTS (
    SELECT 1 FROM photos p2 WHERE p2.listing_id=l.id AND p2.stored_path ~* 'imgsv|r2'
  ))::int AS listings_with_cdn
FROM providers p
JOIN listings l ON l.provider_id=p.id
LEFT JOIN photos ph ON ph.listing_id=l.id
WHERE p.internal_name='sauto'
`);
console.log("stats", stats.rows[0]);

const hosts = await c.query(`
SELECT
  CASE
    WHEN ph.source_url IS NULL THEN 'null_source'
    ELSE regexp_replace(ph.source_url, '^https?://([^/]+).*', '\\1')
  END AS host,
  count(*)::int AS n,
  count(*) FILTER (WHERE ph.stored_path IS NOT NULL AND btrim(ph.stored_path) <> '')::int AS stored,
  count(*) FILTER (WHERE coalesce(ph.mirror_error,'') <> '')::int AS err
FROM providers p
JOIN listings l ON l.provider_id=p.id
JOIN photos ph ON ph.listing_id=l.id
WHERE p.internal_name='sauto'
GROUP BY 1
ORDER BY n DESC
LIMIT 20
`);
console.log("hosts", hosts.rows);

const sample = await c.query(`
SELECT l.id, left(l.title,50) AS title, v.vin,
  (SELECT count(*)::int FROM photos ph WHERE ph.listing_id=l.id) AS photos,
  (SELECT left(ph.source_url,140) FROM photos ph WHERE ph.listing_id=l.id ORDER BY ph.sort_order NULLS LAST, ph.id LIMIT 1) AS src,
  (SELECT left(coalesce(ph.stored_path,''),140) FROM photos ph WHERE ph.listing_id=l.id ORDER BY ph.sort_order NULLS LAST, ph.id LIMIT 1) AS stored,
  (SELECT left(ph.mirror_error,140) FROM photos ph WHERE ph.listing_id=l.id AND coalesce(ph.mirror_error,'')<>'' LIMIT 1) AS err
FROM providers p
JOIN listings l ON l.provider_id=p.id
JOIN vehicles v ON v.id=l.vehicle_id
WHERE p.internal_name='sauto'
ORDER BY l.id DESC
LIMIT 10
`);
console.log("sample", sample.rows);

const errs = await c.query(`
SELECT left(ph.mirror_error,180) AS err, count(*)::int AS n
FROM providers p
JOIN listings l ON l.provider_id=p.id
JOIN photos ph ON ph.listing_id=l.id
WHERE p.internal_name='sauto' AND coalesce(ph.mirror_error,'') <> ''
GROUP BY 1 ORDER BY n DESC LIMIT 15
`);
console.log("errs", errs.rows);

const recent = await c.query(`
SELECT date_trunc('day', l.created_at)::date AS day,
  count(DISTINCT l.id)::int AS listings,
  count(ph.id)::int AS photos,
  count(ph.id) FILTER (WHERE ph.stored_path ~* 'imgsv|r2')::int AS cdn
FROM providers p
JOIN listings l ON l.provider_id=p.id
LEFT JOIN photos ph ON ph.listing_id=l.id
WHERE p.internal_name='sauto' AND l.created_at > now() - interval '14 days'
GROUP BY 1 ORDER BY 1 DESC
`);
console.log("recent_days", recent.rows);

await c.end();
