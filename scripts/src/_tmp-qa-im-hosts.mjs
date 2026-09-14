/**
 * What hosts are recent IM galleries using?
 */
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
await c.query("SET statement_timeout = 60000");

const hosts = await c.query(`
  SELECT
    CASE
      WHEN p.source_url ILIKE '%vis.iaai.com%' THEN 'vis.iaai'
      WHEN p.source_url ILIKE '%cs.copart.com%' THEN 'cs.copart'
      WHEN p.source_url ILIKE '%cars2.import-motor.com%' THEN 'cars2'
      WHEN p.source_url ILIKE '%cars.import-motor.com%' THEN 'cars'
      WHEN p.source_url ILIKE '%ci.encar.com%' THEN 'encar'
      WHEN p.source_url ILIKE '%cdn%' OR p.source_url ILIKE '%cloudfront%' THEN 'cdn_other'
      ELSE 'other'
    END AS host_kind,
    count(*)::int n
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  WHERE pr.internal_name = 'import_motor'
    AND p.photo_group = 'gallery'
    AND p.created_at > NOW() - interval '45 minutes'
  GROUP BY 1
  ORDER BY n DESC
`);
console.log("hosts45m", hosts.rows);

const rich = await c.query(`
  SELECT v.vin, l.source_id,
    count(*)::int gal,
    count(*) FILTER (WHERE p.source_url ILIKE '%vis.iaai.com%')::int iaa,
    count(*) FILTER (WHERE p.source_url ILIKE '%cs.copart.com%')::int copart,
    count(*) FILTER (WHERE p.source_url ILIKE '%import-motor.com%')::int im,
    max(p.created_at) last_photo
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE pr.internal_name = 'import_motor'
    AND p.photo_group = 'gallery'
    AND p.created_at > NOW() - interval '45 minutes'
  GROUP BY 1,2
  HAVING count(*) >= 10
  ORDER BY count(*) DESC
  LIMIT 8
`);
console.log("richGalleries", rich.rows);

await c.end();
