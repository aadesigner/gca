import fs from "node:fs";
import pg from "pg";
const VIN = "JTHD51FF7L5012169";
const DRY = false;
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

// Delete IAA spin frames on Copart-gallery listings (same collision rule), for this VIN first then count all
const delOne = await c.query(`
  DELETE FROM photos p
  USING listings l, vehicles v
  WHERE p.listing_id = l.id
    AND p.vehicle_id = v.id
    AND v.vin = $1
    AND p.photo_group IN ('exterior_3d','interior_3d')
    AND COALESCE(p.source_url,'') ILIKE '%vis.iaai.com%'
    AND EXISTS (
      SELECT 1 FROM photos g WHERE g.listing_id=l.id AND g.photo_group='gallery'
        AND (g.source_url ILIKE '%/copart/%' OR g.source_url ILIKE '%cs.copart%')
    )
    AND NOT EXISTS (
      SELECT 1 FROM photos g2 WHERE g2.listing_id=l.id AND g2.photo_group='gallery'
        AND (g2.source_url ILIKE '%iaai%' OR g2.source_url ILIKE '%/iaa/%' OR g2.source_url ILIKE '%vis.iaai%')
    )
  RETURNING p.id
`, [VIN]);
console.log("purgedThisVin", delOne.rowCount);

const left = await c.query(`
  SELECT photo_group, count(*)::int n FROM photos p
  JOIN vehicles v ON v.id=p.vehicle_id WHERE v.vin=$1 GROUP BY 1
`, [VIN]);
console.log("left", left.rows);
await c.end();
