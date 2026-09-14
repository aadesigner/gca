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
  password: get("PGPASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const p = await c.query(`
  SELECT id, name, internal_name, enabled, parser_version, base_url
  FROM providers
  WHERE internal_name ILIKE '%bidcar%' OR name ILIKE '%bid.car%' OR name ILIKE '%bidcars%'
`);
const jobs = await c.query(`
  SELECT cj.id, cj.status, cj.job_type, cj.pages_processed, cj.listings_fetched,
         cj.vins_new, cj.items_processed, left(cj.error_message,120) AS err,
         cj.updated_at, cj.created_at
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE p.internal_name = 'bidcars'
  ORDER BY cj.id DESC
  LIMIT 10
`);
const listings = await c.query(`
  SELECT count(*)::int AS n,
         count(*) FILTER (WHERE l.created_at > now() - interval '7 days')::int AS n7d,
         count(*) FILTER (WHERE l.created_at > now() - interval '24 hours')::int AS n24h,
         max(l.created_at) AS newest
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'bidcars'
`);
const photos = await c.query(`
  SELECT count(*)::int AS n
  FROM photos ph
  JOIN listings l ON l.id = ph.listing_id
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'bidcars'
`);

console.log(JSON.stringify({
  provider: p.rows,
  recentJobs: jobs.rows,
  listings: listings.rows[0],
  photos: photos.rows[0],
}, null, 2));
await c.end();
