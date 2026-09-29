import fs from "node:fs";
import pg from "pg";
const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT") || 5432),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: false,
  statement_timeout: 180000,
});
await c.connect();

const vin = await c.query(`
  SELECT count(*)::int AS n,
         count(*) FILTER (WHERE coalesce(photo_group,'gallery')='exterior_3d')::int AS spins,
         count(*) FILTER (WHERE source_url ILIKE '%vehimg%' AND source_url NOT ILIKE '%/45405590-%')::int AS foreign_vehimg
  FROM photos ph JOIN vehicles v ON v.id=ph.vehicle_id WHERE v.vin='1FA6P8CF5K5120103'
`);
console.log("vin", vin.rows[0]);

// Count remaining orphan spins (no matching gallery stock on listing)
const orphanCount = await c.query(`
  SELECT count(*)::int AS n
  FROM photos ph
  WHERE coalesce(ph.photo_group,'gallery') = 'exterior_3d'
    AND ph.source_url ILIKE '%partitionKey=%'
    AND NOT EXISTS (
      SELECT 1 FROM photos g
      WHERE g.listing_id = ph.listing_id
        AND coalesce(g.photo_group,'gallery') = 'gallery'
        AND g.source_url ~* 'vis\\.iaai\\.com|mediaretriever\\.iaai\\.com|/iaai/'
        AND g.source_url LIKE '%' || (regexp_match(ph.source_url, 'partitionKey=([0-9]{6,})', 'i'))[1] || '%'
    )
`);
console.log("orphanSpinsRemaining", orphanCount.rows[0]);

let deleted = 0;
for (let i = 0; i < 30; i++) {
  const r = await c.query(`
    WITH doomed AS (
      SELECT ph.id
      FROM photos ph
      WHERE coalesce(ph.photo_group,'gallery') = 'exterior_3d'
        AND ph.source_url ILIKE '%partitionKey=%'
        AND NOT EXISTS (
          SELECT 1 FROM photos g
          WHERE g.listing_id = ph.listing_id
            AND coalesce(g.photo_group,'gallery') = 'gallery'
            AND g.source_url ~* 'vis\\.iaai\\.com|mediaretriever\\.iaai\\.com|/iaai/'
            AND g.source_url LIKE '%' || (regexp_match(ph.source_url, 'partitionKey=([0-9]{6,})', 'i'))[1] || '%'
        )
      LIMIT 2000
    )
    DELETE FROM photos ph USING doomed d WHERE ph.id = d.id
    RETURNING 1
  `);
  deleted += r.rowCount;
  console.log(JSON.stringify({ orphanBatch: i + 1, deleted: r.rowCount, total: deleted }));
  if (r.rowCount === 0) break;
}
console.log(JSON.stringify({ orphanSpinsDeleted: deleted }));
await c.end();
