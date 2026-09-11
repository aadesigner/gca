/**
 * Collapse identical Carpages / OntarioCars listing clones on prod
 * (same provider + VIN + price + mileage — keep oldest, re-point obs/photos).
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-dedupe-carpages-listings.mjs
 *   DRY_RUN=1 node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-dedupe-carpages-listings.mjs
 */
import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const dry = process.env.DRY_RUN === "1";
const c = new pg.Client({
  connectionString: loadProdUrl(),
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0,
});
await c.connect();

const groups = await c.query(`
  SELECT p.internal_name, l.provider_id, l.vin, l.price_amount, l.mileage,
         array_agg(l.id ORDER BY l.id) AS ids,
         count(*)::int AS n
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name IN ('carpages', 'ontariocars')
    AND l.vin IS NOT NULL AND length(l.vin) >= 10
  GROUP BY p.internal_name, l.provider_id, l.vin, l.price_amount, l.mileage
  HAVING count(*) > 1
  ORDER BY n DESC
  LIMIT 5000
`);
console.log("clone_groups", groups.rows.length, "sample", groups.rows.slice(0, 5));

let merged = 0;
let deleted = 0;
for (const g of groups.rows) {
  const ids = g.ids;
  const keep = ids[0];
  const drop = ids.slice(1);
  if (!keep || !drop.length) continue;
  if (dry) {
    merged += 1;
    deleted += drop.length;
    continue;
  }
  await c.query(`UPDATE vehicle_observations SET listing_id = $1 WHERE listing_id = ANY($2::int[])`, [
    keep,
    drop,
  ]);
  await c.query(`UPDATE photos SET listing_id = $1 WHERE listing_id = ANY($2::int[])`, [keep, drop]);
  await c.query(`UPDATE raw_source_records SET listing_id = $1 WHERE listing_id = ANY($2::int[])`, [
    keep,
    drop,
  ]);
  const d = await c.query(`DELETE FROM listings WHERE id = ANY($1::int[])`, [drop]);
  merged += 1;
  deleted += d.rowCount || 0;
}

console.log({ dry, merged_groups: merged, deleted_listings: deleted });
await c.end();
