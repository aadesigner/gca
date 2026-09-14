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

const windows = await c.query(`
  SELECT 'last_5m' AS label,
    count(*)::int AS listings,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM photos ph WHERE ph.listing_id = l.id AND ph.source_url ILIKE '%og-default%'
    ))::int AS og_default,
    count(*) FILTER (WHERE (SELECT count(*)::int FROM photos ph WHERE ph.listing_id = l.id) >= 2)::int AS multi_photo
  FROM listings l JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'thebidrive' AND l.created_at > NOW() - interval '5 minutes'
  UNION ALL
  SELECT '5_to_15m',
    count(*)::int,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM photos ph WHERE ph.listing_id = l.id AND ph.source_url ILIKE '%og-default%'
    ))::int,
    count(*) FILTER (WHERE (SELECT count(*)::int FROM photos ph WHERE ph.listing_id = l.id) >= 2)::int
  FROM listings l JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'thebidrive'
    AND l.created_at <= NOW() - interval '5 minutes'
    AND l.created_at > NOW() - interval '15 minutes'
  UNION ALL
  SELECT '15_to_30m',
    count(*)::int,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM photos ph WHERE ph.listing_id = l.id AND ph.source_url ILIKE '%og-default%'
    ))::int,
    count(*) FILTER (WHERE (SELECT count(*)::int FROM photos ph WHERE ph.listing_id = l.id) >= 2)::int
  FROM listings l JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'thebidrive'
    AND l.created_at <= NOW() - interval '15 minutes'
    AND l.created_at > NOW() - interval '30 minutes'
`);

console.log(JSON.stringify({ windows: windows.rows }, null, 2));
await c.end();
