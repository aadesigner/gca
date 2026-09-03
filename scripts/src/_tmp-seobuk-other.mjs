import pg from "pg";

const url = process.env.DATABASE_URL;
const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
await c.connect();
const other = await c.query(`
  SELECT left(ph.source_url, 120) AS url, count(*)::int AS n
  FROM photos ph
  JOIN listings l ON l.id = ph.listing_id
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'seobuk'
    AND ph.source_url NOT ILIKE '%seobuk.org/assets/admin/images/user%'
    AND ph.source_url NOT ILIKE '%carmanager%'
    AND ph.source_url NOT ILIKE '%imgsv.getcarapi%'
  GROUP BY 1
  ORDER BY n DESC
  LIMIT 20
`);
console.log("LOCAL other photo urls", other.rows);
await c.end();
