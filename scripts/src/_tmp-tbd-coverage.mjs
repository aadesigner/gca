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

const tbd = await c.query(`
  SELECT
    count(*)::int AS total_listings,
    count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM photos ph WHERE ph.listing_id = l.id))::int AS listing_no_photos,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM photos ph WHERE ph.listing_id = l.id AND ph.source_url ILIKE '%og-default%'
    ))::int AS og_default_any,
    count(*) FILTER (WHERE (SELECT count(*) FROM photos ph WHERE ph.listing_id = l.id) >= 2)::int AS multi_photo,
    count(*) FILTER (
      WHERE l.created_at > NOW() - interval '10 minutes'
        AND NOT EXISTS (SELECT 1 FROM photos ph WHERE ph.listing_id = l.id)
    )::int AS new_no_photo_10m
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'thebidrive'
`);

const vehicles = await c.query(`
  SELECT
    count(DISTINCT v.id)::int AS vehicles_with_tbd_listing,
    count(DISTINCT v.id) FILTER (
      WHERE NOT EXISTS (SELECT 1 FROM photos ph WHERE ph.vehicle_id = v.id)
    )::int AS vehicles_no_photos
  FROM vehicles v
  INNER JOIN listings l ON l.vehicle_id = v.id
  INNER JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'thebidrive'
`);

console.log(JSON.stringify({ thebidrive: tbd.rows[0], vehicles: vehicles.rows[0] }, null, 2));
await c.end();
