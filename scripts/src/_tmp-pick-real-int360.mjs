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
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
await c.query("SET statement_timeout = 90000");

const rows = await c.query(`
  SELECT v.vin, v.make, v.model, v.year, l.source_id,
    count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
    count(*) FILTER (WHERE p.photo_group='exterior_3d' AND p.source_url ILIKE '%ThreeSixtyImageRetriever%')::int ext_ok,
    count(*) FILTER (WHERE p.photo_group='interior_3d' AND p.source_url ILIKE '%InteriorImageRetriever%')::int int_ok,
    count(*) FILTER (WHERE p.photo_group='interior_3d' AND p.source_url ILIKE '%~INT~%')::int int_fake,
    max(p.created_at) last_photo
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE pr.internal_name = 'import_motor'
  GROUP BY 1,2,3,4,5
  HAVING count(*) FILTER (WHERE p.photo_group='exterior_3d' AND p.source_url ILIKE '%ThreeSixtyImageRetriever%') >= 12
     AND count(*) FILTER (WHERE p.photo_group='interior_3d' AND p.source_url ILIKE '%InteriorImageRetriever%') >= 1
     AND count(*) FILTER (WHERE p.photo_group='interior_3d' AND p.source_url ILIKE '%~INT~%') = 0
     AND count(*) FILTER (WHERE p.photo_group='gallery') >= 8
  ORDER BY max(p.created_at) DESC
  LIMIT 5
`);
console.log(rows.rows);

const sentra = await c.query(`
  SELECT photo_group, count(*)::int n, min(left(source_url,110)) sample
  FROM photos p JOIN vehicles v ON v.id=p.vehicle_id
  WHERE v.vin='3N1AB7AP6KY202307'
  GROUP BY 1 ORDER BY 1
`);
console.log("sentra", sentra.rows);
await c.end();
