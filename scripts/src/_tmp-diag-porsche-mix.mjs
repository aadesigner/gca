import fs from "node:fs";
import pg from "pg";
const VIN = "WP0AB2A92TS227786";
const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => { const v = vars[n]; return v && typeof v === "object" && "value" in v ? v.value : v; };
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const v = (await c.query(`SELECT id, make, model, year FROM vehicles WHERE vin=$1`, [VIN])).rows[0];
console.log("vehicle", v);

const listings = await c.query(`
  SELECT l.id, pr.internal_name, l.source_id, left(COALESCE(l.source_url,''),120) url,
         (SELECT count(*) FROM photos p WHERE p.listing_id=l.id) photos
  FROM listings l JOIN providers pr ON pr.id=l.provider_id
  WHERE l.vehicle_id=$1
`, [v.id]);
console.log("listings", listings.rows);

const byGroupStock = await c.query(`
  SELECT p.photo_group, p.listing_id,
    COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d+)', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d+)', 'i'))[1],
      (regexp_match(p.source_url, '/iaai/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1],
      'other'
    ) AS stock,
    count(*)::int n,
    min(p.sort_order) mn, max(p.sort_order) mx,
    array_agg(left(p.source_url, 110) ORDER BY p.sort_order) FILTER (WHERE p.sort_order < 3 OR p.sort_order > 30) samples
  FROM photos p
  WHERE p.vehicle_id=$1
  GROUP BY 1,2,3
  ORDER BY 1,3
`, [v.id]);
console.log("byGroupStock", JSON.stringify(byGroupStock.rows, null, 2));

const all = await c.query(`
  SELECT id, listing_id, photo_group, sort_order, left(source_url,130) src, left(COALESCE(stored_path,''),80) stored
  FROM photos WHERE vehicle_id=$1
  ORDER BY photo_group, sort_order, id
`, [v.id]);
console.log("all count", all.rows.length);
for (const r of all.rows.filter(x => x.photo_group !== 'gallery')) {
  console.log(r.photo_group, r.sort_order, r.src);
}
await c.end();
