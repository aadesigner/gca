/**
 * Find duplicate / 1-char-similar VIN pairs from the catalog import.
 * Local DB only.
 */
import pg from "pg";

const url = process.env.DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(url.replace(/^postgres(ql)?:/i, "http:")).hostname;
  } catch {
    return "";
  }
})();
if (!/^(localhost|127\.0\.0\.1|::1)$/i.test(host)) throw new Error(host);

function hamming(a, b) {
  if (a.length !== b.length) return 99;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

const c = new pg.Client({ connectionString: url });
await c.connect();

const catalogListings = (
  await c.query(`
    SELECT l.id, l.vin, l.source_id, l.vehicle_id, l.created_at,
           v.vin AS vehicle_vin, v.make, v.model, v.year
    FROM listings l
    JOIN vehicles v ON v.id = l.vehicle_id
    WHERE l.source_id LIKE 'catalog:%'
    ORDER BY l.id
  `)
).rows;

const vinRows = (
  await c.query(`
    SELECT id, vin, make, model, year
    FROM vehicles
    WHERE vin IS NOT NULL AND length(vin) = 17
  `)
).rows;
const byVin = new Map(vinRows.map((r) => [r.vin, r]));

const exactDupVehicles = (
  await c.query(`
    SELECT vin, array_agg(id ORDER BY id) AS ids, count(*)::int AS n
    FROM vehicles
    WHERE vin IS NOT NULL AND btrim(vin) <> ''
    GROUP BY vin
    HAVING count(*) > 1
    ORDER BY n DESC
    LIMIT 20
  `)
).rows;

const catalogDupListings = (
  await c.query(`
    SELECT l.vin, count(*)::int AS listings,
           count(*) FILTER (WHERE l.source_id LIKE 'catalog:%')::int AS catalog_listings,
           count(*) FILTER (WHERE l.source_id NOT LIKE 'catalog:%')::int AS other_listings
    FROM listings l
    WHERE l.vin IN (SELECT vin FROM listings WHERE source_id LIKE 'catalog:%')
    GROUP BY l.vin
    HAVING count(*) > 1
    ORDER BY listings DESC
    LIMIT 30
  `)
).rows;

const similar = [];
for (const row of catalogListings) {
  const vin = String(row.vehicle_vin || row.vin || "").toUpperCase();
  if (vin.length !== 17) continue;
  for (const other of vinRows) {
    if (other.id === row.vehicle_id) continue;
    const d = hamming(vin, other.vin);
    if (d > 0 && d <= 1) {
      similar.push({
        catalogListing: row.id,
        catalogVehicle: row.vehicle_id,
        catalogVin: vin,
        otherId: other.id,
        otherVin: other.vin,
        dist: d,
        sameModel: String(row.make || "") === String(other.make || "") && String(row.model || "") === String(other.model || ""),
      });
    }
  }
}

console.log(
  JSON.stringify(
    {
      host,
      catalogListings: catalogListings.length,
      exactDupVehicles: exactDupVehicles.length,
      exactDupSample: exactDupVehicles.slice(0, 8),
      catalogDupListings: catalogDupListings.length,
      catalogDupSample: catalogDupListings.slice(0, 10),
      similarPairs: similar.length,
      similarSample: similar.slice(0, 15),
    },
    null,
    2,
  ),
);
await c.end();
