import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const { rows } = await pool.query(`
  SELECT p.internal_name,
         count(*) FILTER (WHERE ph.stored_path IS NULL) AS pending,
         count(*) FILTER (WHERE ph.stored_path ~* 'imgsv\\.getcarapi\\.com') AS cdn
  FROM photos ph
  LEFT JOIN listings l ON l.id = ph.listing_id
  LEFT JOIN providers p ON p.id = l.provider_id
  GROUP BY p.internal_name
  ORDER BY pending DESC NULLS LAST
  LIMIT 20
`);
console.log(JSON.stringify(rows, null, 2));

const { rows: recent } = await pool.query(`
  SELECT p.internal_name, count(*) pending
  FROM photos ph
  LEFT JOIN listings l ON l.id = ph.listing_id
  LEFT JOIN providers p ON p.id = l.provider_id
  WHERE ph.stored_path IS NULL AND ph.created_at > now() - interval '24 hours'
  GROUP BY p.internal_name
  ORDER BY pending DESC
`);
console.log("\nPending last 24h:", recent);

await pool.end();
