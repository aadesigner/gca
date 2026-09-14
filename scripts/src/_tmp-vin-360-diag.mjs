import fs from "node:fs";
import pg from "pg";
const VIN = "JTHD51FF7L5012169";
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

const v = await c.query(`SELECT id, vin, make, model, year FROM vehicles WHERE vin=$1`, [VIN]);
console.log("vehicle", v.rows);

if (v.rows[0]) {
  const vid = v.rows[0].id;
  const byGroup = await c.query(`
    SELECT photo_group, count(*)::int n,
           count(*) FILTER (WHERE stored_path IS NOT NULL AND stored_path <> '')::int mirrored,
           min(left(source_url,120)) sample_src,
           min(left(COALESCE(stored_path,''),120)) sample_stored
    FROM photos WHERE vehicle_id=$1
    GROUP BY 1 ORDER BY 1
  `, [vid]);
  console.log("byGroup", byGroup.rows);

  const listings = await c.query(`
    SELECT l.id, p.internal_name, l.source_id, left(COALESCE(l.source_url,''),120) url,
           (SELECT count(*)::int FROM photos ph WHERE ph.listing_id=l.id) photos
    FROM listings l JOIN providers p ON p.id=l.provider_id
    WHERE l.vehicle_id=$1
    ORDER BY l.last_seen_at DESC NULLS LAST
  `, [vid]);
  console.log("listings", listings.rows);

  const sample = await c.query(`
    SELECT id, listing_id, photo_group, sort_order, is_primary,
           left(source_url,140) src, left(COALESCE(stored_path,''),140) stored
    FROM photos WHERE vehicle_id=$1
    ORDER BY CASE photo_group WHEN 'gallery' THEN 0 WHEN 'exterior_3d' THEN 1 ELSE 2 END, sort_order
    LIMIT 20
  `, [vid]);
  console.log("samplePhotos", sample.rows);

  // orphaned 360 without vehicle link?
  const orphan = await c.query(`
    SELECT count(*)::int n FROM photos p
    JOIN listings l ON l.id=p.listing_id
    WHERE l.vehicle_id=$1 OR p.vehicle_id=$1
  `, [vid]);
  console.log("total linked", orphan.rows[0]);
}

await c.end();
