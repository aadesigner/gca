/**
 * Purge IM photos whose URL embeds a different VIN than the vehicle.
 */
import fs from "node:fs";
import pg from "pg";

const DRY = process.env.DRY_RUN === "1";
const VIN = process.env.VIN?.trim() || null;

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

const vinClause = VIN ? "AND v.vin = $1" : "";
const params = VIN ? [VIN] : [];

const count = await c.query(
  `
SELECT count(*)::int n, count(DISTINCT v.vin)::int vins
FROM photos p
JOIN listings l ON l.id = p.listing_id
JOIN providers pr ON pr.id = l.provider_id
JOIN vehicles v ON v.id = l.vehicle_id
WHERE pr.internal_name = 'import_motor'
  ${vinClause}
  AND (regexp_match(p.source_url, '/([A-HJ-NPR-Z0-9]{17})-\\d+', 'i'))[1] IS NOT NULL
  AND upper((regexp_match(p.source_url, '/([A-HJ-NPR-Z0-9]{17})-\\d+', 'i'))[1]) <> upper(v.vin)
`,
  params,
);
console.log("wrongVinPhotos", count.rows[0], { DRY, VIN });

if (!DRY) {
  const del = await c.query(
    `
DELETE FROM photos p
USING listings l, providers pr, vehicles v
WHERE p.listing_id = l.id
  AND l.provider_id = pr.id
  AND l.vehicle_id = v.id
  AND pr.internal_name = 'import_motor'
  ${vinClause}
  AND (regexp_match(p.source_url, '/([A-HJ-NPR-Z0-9]{17})-\\d+', 'i'))[1] IS NOT NULL
  AND upper((regexp_match(p.source_url, '/([A-HJ-NPR-Z0-9]{17})-\\d+', 'i'))[1]) <> upper(v.vin)
RETURNING p.id
`,
    params,
  );
  console.log("purged", del.rowCount);
}
await c.end();
