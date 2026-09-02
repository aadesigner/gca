import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const providers = await pool.query(`
  SELECT p.internal_name, count(DISTINCT v.id)::int AS vehicles,
         count(DISTINCT v.id) FILTER (WHERE v.created_at > now() - interval '14 days')::int AS recent
  FROM providers p
  LEFT JOIN listings l ON l.provider_id = p.id
  LEFT JOIN vehicles v ON v.id = l.vehicle_id
  GROUP BY p.internal_name
  ORDER BY recent DESC, vehicles DESC
  LIMIT 25
`);
console.log("Top providers by recent vehicles:");
console.table(providers.rows);

const imLike = await pool.query(`
  SELECT p.internal_name, count(DISTINCT v.id)::int AS vehicles
  FROM providers p
  JOIN listings l ON l.provider_id = p.id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE p.internal_name ILIKE '%motor%' OR p.internal_name ILIKE '%import%'
  GROUP BY p.internal_name
`);
console.log("\nImport/motor-like providers:");
console.table(imLike.rows);

const recent = await pool.query(`
  SELECT v.vin, v.created_at, p.internal_name
  FROM vehicles v
  JOIN listings l ON l.vehicle_id = v.id
  JOIN providers p ON p.id = l.provider_id
  WHERE v.created_at > now() - interval '14 days'
  ORDER BY v.created_at DESC
  LIMIT 15
`);
console.log("\nMost recent local VINs:");
console.table(recent.rows);

await pool.end();
