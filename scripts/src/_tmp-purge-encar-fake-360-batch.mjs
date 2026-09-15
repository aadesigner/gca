/**
 * Batch purge leftover Encar/Copart fake IAA 360s (no IAA gallery stills).
 * Usage: node scripts/src/_tmp-purge-encar-fake-360-batch.mjs
 */
import fs from "node:fs";
import pg from "pg";

const VIN = (process.env.VIN || "W1NFD2DB6MA507466").trim().toUpperCase();
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
await c.query("SET max_parallel_workers_per_gather = 0");

const after = await c.query(
  `SELECT p.photo_group, count(*)::int n
   FROM photos p JOIN vehicles v ON v.id = p.vehicle_id
   WHERE v.vin = $1 GROUP BY 1 ORDER BY 1`,
  [VIN],
);
console.log("afterVin", VIN, after.rows);

let total = 0;
for (;;) {
  const del = await c.query(`
    DELETE FROM photos
    WHERE id IN (
      SELECT p.id
      FROM photos p
      WHERE p.photo_group IN ('exterior_3d','interior_3d')
        AND p.listing_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM photos g
          WHERE g.listing_id = p.listing_id
            AND COALESCE(g.photo_group, 'gallery') = 'gallery'
            AND (g.source_url ILIKE '%vis.iaai.com%' OR g.source_url ILIKE '%mediaretriever.iaai.com%')
        )
        AND EXISTS (
          SELECT 1 FROM photos g
          WHERE g.listing_id = p.listing_id
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
      LIMIT 2000
    )
    RETURNING id
  `);
  total += del.rowCount;
  console.log("batch", del.rowCount, "total", total);
  if (del.rowCount === 0) break;
}
console.log("done", total);
await c.end();
