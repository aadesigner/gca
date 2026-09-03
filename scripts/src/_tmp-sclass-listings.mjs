const vin = "WDDUX8GB8JA397509";
// Prefer local API if up, else build from DB fields
import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const rows = await c.query(`
  SELECT p.internal_name, l.price_amount, l.price_currency, l.price_usd, l.price_eur, l.source_id, l.is_active
  FROM listings l JOIN providers p ON p.id=l.provider_id
  JOIN vehicles v ON v.id=l.vehicle_id
  WHERE v.vin=$1
`, [vin]);
console.log(JSON.stringify(rows.rows, null, 2));
await c.end();
