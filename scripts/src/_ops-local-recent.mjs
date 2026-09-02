import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(`
  SELECT count(*)::int AS vins7d
  FROM vehicles
  WHERE created_at > now() - interval '7 days'
`);
const byProvider = await pool.query(`
  SELECT p.internal_name, count(DISTINCT v.id)::int AS vins
  FROM vehicles v
  JOIN listings l ON l.vehicle_id = v.id
  JOIN providers p ON p.id = l.provider_id
  WHERE v.created_at > now() - interval '7 days'
  GROUP BY p.internal_name
  ORDER BY vins DESC
  LIMIT 15
`);
console.log("local vins last 7d:", rows[0].vins7d);
console.table(byProvider.rows);
await pool.end();
