import fs from "node:fs";
import pg from "pg";
const vins = ["WP0AB2A92TS227786","JM3KFBCM7M0411538","1N4BL4EV0RN336801","WP1AB2A53HLB11672"];
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
for (const vin of vins) {
  const r = await c.query(`
    SELECT v.vin, v.make, v.model, v.year,
      count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
      count(*) FILTER (WHERE p.photo_group='exterior_3d')::int ext,
      count(*) FILTER (WHERE p.photo_group='interior_3d')::int int,
      count(*) FILTER (WHERE p.photo_group IN ('exterior_3d','interior_3d') AND COALESCE(p.stored_path,'')<>'')::int spin_cdn,
      (array_agg(DISTINCT left(p.source_url,100)) FILTER (WHERE p.photo_group='gallery'))[1:3] gal_samples,
      (array_agg(DISTINCT left(p.source_url,100)) FILTER (WHERE p.photo_group='exterior_3d'))[1:2] ext_samples,
      array_agg(DISTINCT pr.internal_name) providers
    FROM vehicles v
    JOIN photos p ON p.vehicle_id=v.id
    LEFT JOIN listings l ON l.id=p.listing_id
    LEFT JOIN providers pr ON pr.id=l.provider_id
    WHERE v.vin=$1
    GROUP BY v.id
  `, [vin]);
  console.log(JSON.stringify(r.rows[0], null, 2));
}

// purge count for bad mix including copart provider
const bad = await c.query(`
  SELECT count(DISTINCT v.vin)::int vins, count(*)::int frames
  FROM photos p
  JOIN listings l ON l.id=p.listing_id
  JOIN vehicles v ON v.id=p.vehicle_id
  WHERE p.photo_group IN ('exterior_3d','interior_3d')
    AND COALESCE(p.source_url,'') ILIKE '%vis.iaai.com%'
    AND EXISTS (
      SELECT 1 FROM photos g WHERE g.listing_id=l.id AND g.photo_group='gallery'
        AND (g.source_url ILIKE '%/copart/%' OR g.source_url ILIKE '%cs.copart%')
    )
    AND NOT EXISTS (
      SELECT 1 FROM photos g2 WHERE g2.listing_id=l.id AND g2.photo_group='gallery'
        AND (g2.source_url ILIKE '%iaai%' OR g2.source_url ILIKE '%/iaa/%' OR g2.source_url ILIKE '%vis.iaai%')
    )
`);
console.log("badMixRemaining", bad.rows[0]);
await c.end();
