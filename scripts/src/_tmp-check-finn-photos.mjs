import fs from "node:fs";
import pg from "pg";

const VINS = ["KNACC81GFK5024200", "WDD2050401F222026", "WAUZZZ4G6HN011606"];
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
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

for (const vin of VINS) {
  const v = await c.query(
    `SELECT id, vin, make, model, year FROM vehicles WHERE vin = $1`,
    [vin],
  );
  if (!v.rows[0]) {
    console.log(vin, "NO VEHICLE");
    continue;
  }
  const vehicleId = v.rows[0].id;
  const photos = await c.query(
    `SELECT photo_group, count(*)::int n,
            count(*) FILTER (WHERE stored_path IS NOT NULL AND stored_path <> '')::int with_cdn,
            count(*) FILTER (WHERE source_url ILIKE '%finn%')::int finn,
            count(*) FILTER (WHERE source_url ILIKE '%import-motor%')::int im,
            min(left(source_url, 100)) AS sample
     FROM photos WHERE vehicle_id = $1 GROUP BY 1 ORDER BY 1`,
    [vehicleId],
  );
  const listings = await c.query(
    `SELECT l.id, pr.internal_name, l.source_id, l.is_active, l.source_url,
            (SELECT count(*)::int FROM photos p WHERE p.listing_id = l.id) AS photos
     FROM listings l
     JOIN providers pr ON pr.id = l.provider_id
     WHERE l.vehicle_id = $1 OR l.vin = $2
     ORDER BY l.id`,
    [vehicleId, vin],
  );
  console.log("\n===", vin, v.rows[0].make, v.rows[0].model, "===");
  console.log("photosByGroup", photos.rows);
  console.log("listings", listings.rows);
}

// Recent gallery deletes? sample finn with 0 photos
const sample = await c.query(`
  SELECT v.vin, v.make, v.model,
    count(p.id)::int photos,
    count(p.id) FILTER (WHERE COALESCE(p.photo_group,'gallery')='gallery')::int gallery
  FROM vehicles v
  JOIN listings l ON l.vehicle_id = v.id
  JOIN providers pr ON pr.id = l.provider_id AND pr.internal_name = 'finn'
  LEFT JOIN photos p ON p.vehicle_id = v.id
  GROUP BY v.id
  HAVING count(p.id) = 0
  ORDER BY v.id DESC
  LIMIT 10
`);
console.log("\nfinnZeroPhotos sample", sample.rows);

const finnStats = await c.query(`
  SELECT
    count(DISTINCT v.id)::int vehicles,
    count(DISTINCT v.id) FILTER (
      WHERE EXISTS (SELECT 1 FROM photos p WHERE p.vehicle_id = v.id AND COALESCE(p.photo_group,'gallery')='gallery')
    )::int with_gallery,
    count(DISTINCT v.id) FILTER (
      WHERE NOT EXISTS (SELECT 1 FROM photos p WHERE p.vehicle_id = v.id)
    )::int no_photos
  FROM vehicles v
  JOIN listings l ON l.vehicle_id = v.id
  JOIN providers pr ON pr.id = l.provider_id AND pr.internal_name = 'finn'
`);
console.log("finnStats", finnStats.rows[0]);

await c.end();
