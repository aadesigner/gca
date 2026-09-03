import pg from "pg";

const vin = "WDDUX8GB8JA397509";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const v = await c.query("select id, vin, make, model, year from vehicles where vin=$1", [vin]);
console.log("vehicle", v.rows[0]);
if (!v.rows[0]) {
  await c.end();
  process.exit(0);
}
const id = v.rows[0].id;

const tables = await c.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name ILIKE '%auction%'
`);
console.log("auction tables", tables.rows);

for (const t of tables.rows) {
  const cols = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`,
    [t.table_name],
  );
  console.log(t.table_name, cols.rows.map((r) => r.column_name));
}

const listings = await c.query(
  `SELECT l.id, p.internal_name, l.price_amount, l.price_currency, l.price_usd, l.price_eur, l.source_id
   FROM listings l JOIN providers p ON p.id=l.provider_id WHERE l.vehicle_id=$1`,
  [id],
);
console.log("listings", listings.rows);

const obs = await c.query(
  `SELECT o.id, o.listing_status, o.price_amount, o.price_currency, o.price_usd, o.price_eur, o.observed_at, p.internal_name
   FROM observations o
   LEFT JOIN listings l ON l.id=o.listing_id
   LEFT JOIN providers p ON p.id=l.provider_id
   WHERE o.vehicle_id=$1 AND (o.listing_status ILIKE '%sold%' OR o.price_amount IS NOT NULL)
   ORDER BY o.observed_at DESC NULLS LAST LIMIT 30`,
  [id],
);
console.log("observations", obs.rows);

const events = await c.query(
  `SELECT id, event_type, description, occurred_at, left(coalesce(metadata::text,''), 300) AS meta
   FROM vehicle_events WHERE vehicle_id=$1 AND (event_type='sale' OR description ILIKE '%price%' OR description ILIKE '%sold%')
   ORDER BY occurred_at DESC NULLS LAST LIMIT 40`,
  [id],
);
console.log("sale events", events.rows);

await c.end();
