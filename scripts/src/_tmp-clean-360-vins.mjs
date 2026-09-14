import fs from "node:fs";
import pg from "pg";
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

// Clean 360: has exterior_3d AND gallery that looks IAA (not Copart-only)
const clean = await c.query(`
  WITH cand AS (
    SELECT v.id, v.vin, v.make, v.model, v.year,
      count(*) FILTER (WHERE p.photo_group='exterior_3d')::int AS ext,
      count(*) FILTER (WHERE p.photo_group='interior_3d')::int AS int,
      count(*) FILTER (WHERE p.photo_group='gallery')::int AS gal,
      count(*) FILTER (WHERE p.photo_group='gallery' AND (
        COALESCE(p.source_url,p.stored_path,'') ILIKE '%iaai%'
        OR COALESCE(p.source_url,p.stored_path,'') ILIKE '%/iaa/%'
        OR COALESCE(p.source_url,p.stored_path,'') ILIKE '%vis.iaai%'
      ))::int AS gal_iaa,
      count(*) FILTER (WHERE p.photo_group='gallery' AND (
        COALESCE(p.source_url,p.stored_path,'') ILIKE '%/copart/%'
        OR COALESCE(p.source_url,p.stored_path,'') ILIKE '%cs.copart%'
      ))::int AS gal_copart,
      count(*) FILTER (WHERE p.photo_group IN ('exterior_3d','interior_3d') AND COALESCE(p.stored_path,'') <> '')::int AS spin_mirrored
    FROM vehicles v
    JOIN photos p ON p.vehicle_id=v.id
    WHERE p.photo_group IN ('gallery','exterior_3d','interior_3d')
    GROUP BY v.id
    HAVING count(*) FILTER (WHERE p.photo_group='exterior_3d') >= 12
  )
  SELECT * FROM cand
  WHERE gal_iaa > 0 AND gal_copart = 0
  ORDER BY ext DESC, spin_mirrored DESC, gal DESC
  LIMIT 12
`);
console.log("cleanIaa360", clean.rows);

// Also import_motor provider with IAA gallery
const im = await c.query(`
  SELECT v.vin, v.make, v.model, v.year,
    count(*) FILTER (WHERE p.photo_group='exterior_3d')::int ext,
    count(*) FILTER (WHERE p.photo_group='interior_3d')::int int,
    count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
    count(*) FILTER (WHERE p.photo_group='gallery' AND COALESCE(p.source_url,'') ILIKE '%iaa%')::int gal_iaa,
    count(*) FILTER (WHERE p.photo_group='gallery' AND COALESCE(p.source_url,'') ILIKE '%copart%')::int gal_copart
  FROM photos p
  JOIN listings l ON l.id=p.listing_id
  JOIN providers pr ON pr.id=l.provider_id
  JOIN vehicles v ON v.id=p.vehicle_id
  WHERE pr.internal_name IN ('import_motor','iaa')
    AND p.photo_group IN ('gallery','exterior_3d','interior_3d')
  GROUP BY v.id, v.vin, v.make, v.model, v.year
  HAVING count(*) FILTER (WHERE p.photo_group='exterior_3d') >= 12
     AND count(*) FILTER (WHERE p.photo_group='gallery' AND COALESCE(p.source_url,'') ILIKE '%iaa%') > 0
     AND count(*) FILTER (WHERE p.photo_group='gallery' AND COALESCE(p.source_url,'') ILIKE '%copart%') = 0
  ORDER BY ext DESC
  LIMIT 10
`);
console.log("imIaa", im.rows);

// How many Copart-gallery + IAA-spin leftovers remain?
const bad = await c.query(`
  SELECT count(DISTINCT p.vehicle_id)::int vehicles, count(*)::int frames
  FROM photos p
  JOIN listings l ON l.id=p.listing_id
  WHERE p.photo_group IN ('exterior_3d','interior_3d')
    AND COALESCE(p.source_url,'') ILIKE '%vis.iaai.com%'
    AND EXISTS (
      SELECT 1 FROM photos g WHERE g.listing_id=l.id AND g.photo_group='gallery'
        AND (COALESCE(g.source_url,'') ILIKE '%/copart/%' OR COALESCE(g.source_url,'') ILIKE '%cs.copart%')
    )
    AND NOT EXISTS (
      SELECT 1 FROM photos g2 WHERE g2.listing_id=l.id AND g2.photo_group='gallery'
        AND (COALESCE(g2.source_url,'') ILIKE '%iaai%' OR COALESCE(g2.source_url,'') ILIKE '%/iaa/%')
    )
`);
console.log("remainingBadMix", bad.rows[0]);

await c.end();
