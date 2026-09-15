/**
 * Purge fake IAA 360 frames on Encar / KR Import Motor mirrors.
 * Lot IDs collide with IAA stock partitions — never keep 360 without IAA gallery stills.
 *
 * Usage: node scripts/src/_tmp-purge-encar-fake-360.mjs
 * Optional: VIN=W1NFD2DB6MA507466 node ...
 */
import fs from "node:fs";
import pg from "pg";

const VIN = (process.env.VIN || "").trim().toUpperCase() || null;
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

if (VIN) {
  const before = await c.query(
    `
    SELECT p.photo_group, count(*)::int n,
      count(*) FILTER (WHERE p.source_url ILIKE '%iaai%' OR p.source_url ILIKE '%mediaretriever%')::int iaa
    FROM photos p
    JOIN vehicles v ON v.id = p.vehicle_id
    WHERE v.vin = $1
    GROUP BY 1 ORDER BY 1
  `,
    [VIN],
  );
  console.log("before", VIN, before.rows);

  const delVin = await c.query(
    `
    DELETE FROM photos p
    USING vehicles v
    WHERE p.vehicle_id = v.id AND v.vin = $1
      AND p.photo_group IN ('exterior_3d','interior_3d')
    RETURNING p.id, p.photo_group, left(p.source_url, 120) AS url
  `,
    [VIN],
  );
  console.log("purgedVin360", delVin.rowCount, delVin.rows.slice(0, 5));
}

const suspect = await c.query(`
WITH bad AS (
  SELECT l.id AS listing_id, v.vin
  FROM listings l
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE EXISTS (
    SELECT 1 FROM photos p
    WHERE p.listing_id = l.id
      AND p.photo_group IN ('exterior_3d','interior_3d')
  )
  AND NOT EXISTS (
    SELECT 1 FROM photos g
    WHERE g.listing_id = l.id
      AND COALESCE(g.photo_group, 'gallery') = 'gallery'
      AND (
        g.source_url ILIKE '%vis.iaai.com%'
        OR g.source_url ILIKE '%mediaretriever.iaai.com%'
      )
  )
  AND EXISTS (
    SELECT 1 FROM photos g
    WHERE g.listing_id = l.id
      AND COALESCE(g.photo_group, 'gallery') = 'gallery'
      AND (
        g.source_url ILIKE '%/encar/%'
        OR g.source_url ILIKE '%ci.encar.com%'
        OR g.source_url ILIKE '%img.encar.com%'
        OR g.source_url ILIKE '%cars.import-motor.com/encar/%'
        OR g.source_url ILIKE '%cars2.import-motor.com/encar/%'
        OR g.source_url ILIKE '%cs.copart.com%'
        OR g.source_url ILIKE '%/copart/%'
      )
  )
)
SELECT count(*)::int listings, count(DISTINCT vin)::int vins FROM bad
`);
console.log("suspectEncarCopartFake360", suspect.rows[0]);

const delBroad = await c.query(`
WITH bad AS (
  SELECT l.id AS listing_id
  FROM listings l
  WHERE EXISTS (
    SELECT 1 FROM photos p
    WHERE p.listing_id = l.id
      AND p.photo_group IN ('exterior_3d','interior_3d')
  )
  AND NOT EXISTS (
    SELECT 1 FROM photos g
    WHERE g.listing_id = l.id
      AND COALESCE(g.photo_group, 'gallery') = 'gallery'
      AND (
        g.source_url ILIKE '%vis.iaai.com%'
        OR g.source_url ILIKE '%mediaretriever.iaai.com%'
      )
  )
  AND EXISTS (
    SELECT 1 FROM photos g
    WHERE g.listing_id = l.id
      AND COALESCE(g.photo_group, 'gallery') = 'gallery'
      AND (
        g.source_url ILIKE '%/encar/%'
        OR g.source_url ILIKE '%ci.encar.com%'
        OR g.source_url ILIKE '%img.encar.com%'
        OR g.source_url ILIKE '%cars.import-motor.com/encar/%'
        OR g.source_url ILIKE '%cars2.import-motor.com/encar/%'
        OR g.source_url ILIKE '%cs.copart.com%'
        OR g.source_url ILIKE '%/copart/%'
      )
  )
)
DELETE FROM photos p
USING bad b
WHERE p.listing_id = b.listing_id
  AND p.photo_group IN ('exterior_3d','interior_3d')
RETURNING p.id
`);
console.log("purgedSuspectFake360Frames", delBroad.rowCount);

if (VIN) {
  const after = await c.query(
    `
    SELECT p.photo_group, count(*)::int n
    FROM photos p
    JOIN vehicles v ON v.id = p.vehicle_id
    WHERE v.vin = $1
    GROUP BY 1 ORDER BY 1
  `,
    [VIN],
  );
  console.log("after", VIN, after.rows);
}

await c.end();
