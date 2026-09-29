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
  statement_timeout: 120000,
});
await c.connect();
let total = 0;
for (let i = 0; i < 50; i++) {
  const r = await c.query(`
    WITH doomed AS (
      SELECT ph.id
      FROM photos ph
      JOIN listings l ON l.id = ph.listing_id
      JOIN providers p ON p.id = l.provider_id
      WHERE p.internal_name = 'salvagebid'
        AND ph.source_url ILIKE '%vehimg%'
        AND (regexp_match(ph.source_url, '/([0-9]{6,})-[0-9]{0,3}[A-Za-z]?\\.(?:jpe?g|webp|png)', 'i'))[1]
            IS DISTINCT FROM
            regexp_replace(split_part(l.source_id, '-', 1), '[^0-9]', '', 'g')
      LIMIT 2000
    )
    DELETE FROM photos ph USING doomed d WHERE ph.id = d.id
    RETURNING ph.id
  `);
  total += r.rowCount;
  console.log(JSON.stringify({ batch: i + 1, deleted: r.rowCount, total }));
  if (r.rowCount === 0) break;
}
// IM wrong spins where partitionKey != im lot
let spins = 0;
for (let i = 0; i < 50; i++) {
  const r = await c.query(`
    WITH doomed AS (
      SELECT ph.id
      FROM photos ph
      JOIN listings l ON l.id = ph.listing_id
      JOIN providers p ON p.id = l.provider_id
      WHERE p.internal_name = 'import_motor'
        AND coalesce(ph.photo_group,'gallery') = 'exterior_3d'
        AND ph.source_url ILIKE '%partitionKey=%'
        AND (regexp_match(ph.source_url, 'partitionKey=([0-9]{6,})', 'i'))[1]
            IS DISTINCT FROM
            regexp_replace(regexp_replace(l.source_id, '^im-', '', 'i'), '[^0-9].*$', '')
        AND NOT EXISTS (
          SELECT 1 FROM photos g
          WHERE g.listing_id = ph.listing_id
            AND coalesce(g.photo_group,'gallery') = 'gallery'
            AND g.source_url LIKE '%' || (regexp_match(ph.source_url, 'partitionKey=([0-9]{6,})', 'i'))[1] || '%'
        )
      LIMIT 2000
    )
    DELETE FROM photos ph USING doomed d WHERE ph.id = d.id
    RETURNING ph.id
  `);
  spins += r.rowCount;
  console.log(JSON.stringify({ spinBatch: i + 1, deleted: r.rowCount, spins }));
  if (r.rowCount === 0) break;
}
const check = await c.query(`
  SELECT count(*)::int AS n,
         count(*) FILTER (WHERE coalesce(photo_group,'gallery')='exterior_3d')::int AS spins
  FROM photos ph JOIN vehicles v ON v.id=ph.vehicle_id
  WHERE v.vin='1FA6P8CF5K5120103'
`);
console.log(JSON.stringify({ vinRemaining: check.rows[0], vehimgDeleted: total, spinsDeleted: spins }));
await c.end();
