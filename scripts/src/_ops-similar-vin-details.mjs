import pg from "pg";

const url = process.env.DATABASE_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();

function hamming(a, b) {
  if (a.length !== b.length) return 99;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

const catalog = (
  await c.query(`
    SELECT l.id, l.vin, l.vehicle_id, v.make, v.model, v.year, v.current_known_mileage AS km
    FROM listings l JOIN vehicles v ON v.id = l.vehicle_id
    WHERE l.source_id LIKE 'catalog:%'
  `)
).rows;

const others = (
  await c.query(`
    SELECT v.id, v.vin, v.make, v.model, v.year, v.current_known_mileage AS km
    FROM vehicles v
    WHERE v.vin IS NOT NULL AND length(v.vin) = 17
      AND v.id NOT IN (SELECT vehicle_id FROM listings WHERE source_id LIKE 'catalog:%')
  `)
).rows;

const pairs = [];
for (const row of catalog) {
  const vin = String(row.vin || "").toUpperCase();
  for (const o of others) {
    const d = hamming(vin, o.vin);
    if (d !== 1) continue;
    pairs.push({
      catalogVin: vin,
      otherVin: o.vin,
      catalog: `${row.year} ${row.make} ${row.model} ${row.km}`,
      other: `${o.year} ${o.make} ${o.model} ${o.km}`,
      catalogVehicle: row.vehicle_id,
      otherVehicle: o.id,
      catalogListing: row.id,
    });
  }
}

console.log(JSON.stringify({ catalog: catalog.length, pairs: pairs.length, pairs }, null, 2));
await c.end();
