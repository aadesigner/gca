import pg from "pg";
const url = process.env.DATABASE_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
const vin = "KMHD351UBCU049689";
const listings = (await c.query(`SELECT id, vin, source_id, vehicle_id, updated_at FROM listings WHERE vin = $1 OR source_id ILIKE '%'||$1||'%' LIMIT 10`, [vin])).rows;
const vehicles = (await c.query(`SELECT id, vin, make, model, year FROM vehicles WHERE vin = $1`, [vin])).rows;
console.log(JSON.stringify({ listings, vehicles }, null, 2));
await c.end();
