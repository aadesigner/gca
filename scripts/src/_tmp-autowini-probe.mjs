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

const sample = await c.query(`
  SELECT l.source_id, l.source_url,
    (SELECT count(*)::int FROM photos ph WHERE ph.listing_id = l.id) AS photo_count
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'autowini'
    AND l.created_at > NOW() - interval '24 hours'
  ORDER BY l.created_at DESC
  LIMIT 10
`);

const dist = await c.query(`
  SELECT
    (SELECT count(*)::int FROM photos ph WHERE ph.listing_id = l.id) AS n,
    count(*)::int AS listings
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'autowini' AND l.created_at > NOW() - interval '7 days'
  GROUP BY 1
  ORDER BY 1
  LIMIT 15
`);

console.log(JSON.stringify({ sample: sample.rows, dist: dist.rows }, null, 2));
await c.end();
