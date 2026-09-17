import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const vin = await c.query(`
  SELECT v.vin FROM vehicles v
  JOIN listings l ON l.vehicle_id=v.id
  JOIN providers p ON p.id=l.provider_id
  WHERE p.internal_name='carstat'
  ORDER BY (SELECT count(*) FROM photos ph WHERE ph.listing_id=l.id) DESC, v.id DESC
  LIMIT 1
`);
const v = vin.rows[0]?.vin;
console.log("vin", v);
const photos = await c.query(`
  SELECT p.sort_order, p.is_primary, left(p.source_url,100) u, left(coalesce(p.stored_path,''),60) s
  FROM photos p
  JOIN listings l ON l.id=p.listing_id
  JOIN providers pr ON pr.id=l.provider_id
  JOIN vehicles v ON v.id=l.vehicle_id
  WHERE pr.internal_name='carstat' AND v.vin=$1
  ORDER BY p.sort_order NULLS LAST, p.id
  LIMIT 30
`, [v]);
console.log(photos.rows);

const ev = await c.query(`
  SELECT left(description,80) d, left(metadata::text,200) m
  FROM vehicle_events ve
  JOIN vehicles v ON v.id=ve.vehicle_id
  WHERE v.vin=$1
  ORDER BY ve.id
`, [v]);
console.log("events", ev.rows.slice(0,8));
await c.end();
