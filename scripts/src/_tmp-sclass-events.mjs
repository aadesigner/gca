import pg from "pg";
const vin = "WDDUX8GB8JA397509";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const id = (await c.query("select id from vehicles where vin=$1", [vin])).rows[0].id;
const tables = await c.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND (
    table_name ILIKE '%obs%' OR table_name ILIKE '%price%' OR table_name ILIKE '%event%'
  ) ORDER BY 1`);
console.log(tables.rows.map(r=>r.table_name));
const events = await c.query(`
  SELECT id, event_type, description, occurred_at, left(coalesce(metadata::text,''), 400) AS meta
  FROM vehicle_events WHERE vehicle_id=$1
    AND (event_type='sale' OR description ILIKE '%sold%' OR description ILIKE '%Final price%' OR metadata::text ILIKE '%price%')
  ORDER BY occurred_at DESC NULLS LAST LIMIT 40`, [id]);
console.log("events", events.rows);
await c.end();
