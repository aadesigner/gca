import { pool } from "@workspace/db";
const r = await pool.query(`
  SELECT pr.internal_name, COUNT(*)::int AS n
  FROM listings l JOIN providers pr ON pr.id = l.provider_id
  WHERE l.is_active GROUP BY 1 ORDER BY n DESC
`);
console.log("providers", r.rows);
const e = await pool.query(`
  SELECT COUNT(*)::int AS n FROM listings l
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  JOIN photos p ON p.listing_id = l.id
  WHERE pr.internal_name = 'encar' AND l.is_active LIMIT 1
`);
console.log("encar with photos", e.rows);
await pool.end();
