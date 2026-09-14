import fs from "node:fs";
import pg from "pg";
const VIN = "WVWED71K98W309297";
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
const v = (await c.query(`SELECT * FROM vehicles WHERE vin=$1`, [VIN])).rows[0];
console.log("vehicle", { id:v.id, vin:v.vin, make:v.make, model:v.model, year:v.year, color:v.color, body:v.body_type });
const listings = await c.query(`
  SELECT l.id, pr.internal_name, l.source_id, l.title, left(COALESCE(l.source_url,''),140) url,
    l.mileage, (SELECT count(*) FROM photos p WHERE p.listing_id=l.id) photos
  FROM listings l JOIN providers pr ON pr.id=l.provider_id WHERE l.vehicle_id=$1
`, [v.id]);
console.log("listings", listings.rows);
const photos = await c.query(`
  SELECT photo_group, sort_order, left(source_url,140) src,
    COALESCE(
      (regexp_match(source_url, 'partitionKey=(\\d+)', 'i'))[1],
      (regexp_match(source_url, 'imageKeys=(\\d+)', 'i'))[1],
      (regexp_match(source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d+)/', 'i'))[1]
    ) stock
  FROM photos WHERE vehicle_id=$1 ORDER BY photo_group, sort_order LIMIT 40
`, [v.id]);
console.log("photos sample");
for (const p of photos.rows) console.log(p.photo_group, p.sort_order, p.stock, p.src);

// Does this stock appear on OTHER vins?
const stock = "125105596";
const other = await c.query(`
  SELECT v.vin, v.make, v.model, v.year, count(*)::int n
  FROM photos p JOIN vehicles v ON v.id=p.vehicle_id
  WHERE p.source_url ILIKE '%' || $1 || '%'
  GROUP BY 1,2,3,4 ORDER BY n DESC LIMIT 10
`, [stock]);
console.log("stockOnVins", other.rows);

// raw sources?
const raws = await c.query(`
  SELECT left(COALESCE(payload::text, raw::text, ''), 200) FROM raw_source_records WHERE vin=$1 LIMIT 3
`).catch(async e => {
  const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name LIKE '%raw%'`);
  return { err: e.message, cols: cols.rows };
});
console.log("raw", raws.err || raws.rows || raws);
await c.end();
