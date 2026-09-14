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

const r = await c.query(`
SELECT
  (SELECT count(*)::int FROM photos WHERE photo_group='exterior_3d') AS ext3d,
  (SELECT count(*)::int FROM photos WHERE photo_group='interior_3d') AS int3d,
  (SELECT count(*)::int FROM photos ph
     JOIN listings l ON l.id=ph.listing_id
     JOIN providers p ON p.id=l.provider_id
    WHERE p.internal_name='thebidrive'
      AND ph.source_url ILIKE '%og-default%'
      AND ph.created_at > NOW() - interval '24 hours') AS bidrive_og_24h,
  (SELECT count(*)::int FROM listings l
     JOIN providers p ON p.id=l.provider_id
    WHERE p.internal_name='autowini'
      AND l.created_at > NOW() - interval '24 hours'
      AND (SELECT count(*) FROM photos ph WHERE ph.listing_id=l.id)=5) AS autowini_exactly5_24h,
  (SELECT count(*)::int FROM listings l
     JOIN providers p ON p.id=l.provider_id
    WHERE p.internal_name='autowini'
      AND l.created_at > NOW() - interval '24 hours'
      AND (SELECT count(*) FROM photos ph WHERE ph.listing_id=l.id)>5) AS autowini_gt5_24h,
  (SELECT count(*)::int FROM listings l
     JOIN providers p ON p.id=l.provider_id
    WHERE p.internal_name='thebidrive'
      AND l.created_at > NOW() - interval '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM photos ph
        WHERE ph.listing_id=l.id AND ph.source_url NOT ILIKE '%og-default%'
      )) AS bidrive_no_real_24h
`);
console.log(JSON.stringify(r.rows[0], null, 2));
await c.end();
