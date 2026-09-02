import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(`
  SELECT
    count(DISTINCT v.id)::int AS total,
    count(DISTINCT v.id) FILTER (WHERE v.created_at > now() - interval '30 days')::int AS last30d,
    count(DISTINCT v.id) FILTER (WHERE v.created_at > now() - interval '7 days')::int AS last7d
  FROM vehicles v
  JOIN listings l ON l.vehicle_id = v.id
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'import_motor'
`);
console.log(JSON.stringify(rows[0], null, 2));
await pool.end();
