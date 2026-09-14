import fs from "node:fs";
import pg from "pg";
const VIN = "JTDKDTB34C1517287";
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
  SELECT l.id, pr.internal_name, l.source_id, left(COALESCE(l.source_url,''),140) url,
    (SELECT count(*)::int FROM photos p WHERE p.listing_id=l.id) photos
  FROM listings l JOIN providers pr ON pr.id=l.provider_id WHERE l.vehicle_id=$1
`, [v.id]);
console.log("listings", listings.rows);
const groups = await c.query(`
  SELECT photo_group, count(*)::int n,
    count(*) FILTER (WHERE stored_path IS NOT NULL AND stored_path<>'')::int mirrored,
    array_agg(left(source_url,100) ORDER BY sort_order) FILTER (WHERE sort_order < 3) samples
  FROM photos WHERE vehicle_id=$1 GROUP BY 1 ORDER BY 1
`, [v.id]);
console.log("groups", JSON.stringify(groups.rows, null, 2));
const all = await c.query(`
  SELECT id, photo_group, sort_order, left(source_url,130) src, left(COALESCE(stored_path,''),90) stored
  FROM photos WHERE vehicle_id=$1 ORDER BY photo_group, sort_order
`, [v.id]);
for (const r of all.rows) console.log(r.photo_group, r.sort_order, r.src, "|", r.stored);
await c.end();
