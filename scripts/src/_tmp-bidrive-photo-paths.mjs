import pg from "pg";

const c = new pg.Client({
  host: process.env.PROD_PG_HOST,
  port: Number(process.env.PROD_PG_PORT),
  user: process.env.PROD_PG_USER,
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE,
  ssl: false,
});
await c.connect();

const r = await c.query(`
  SELECT l.source_id, l.source_url, v.vin,
         array_agg(ph.source_url ORDER BY ph.sort_order, ph.id) AS urls
  FROM listings l
  JOIN providers p ON p.id=l.provider_id
  JOIN vehicles v ON v.id=l.vehicle_id
  JOIN photos ph ON ph.vehicle_id=l.vehicle_id
  WHERE p.internal_name='thebidrive'
  GROUP BY l.id, l.source_id, l.source_url, v.vin
  HAVING count(ph.id) >= 8
  ORDER BY l.created_at DESC NULLS LAST
  LIMIT 6
`);

for (const row of r.rows) {
  const urls = row.urls || [];
  const prefixes = new Map();
  for (const u of urls) {
    // cdn.thebidrive.com/{a}/{b}/...
    const m = u.match(/cdn\.thebidrive\.com\/([^/]+)\/([^/]+)\//i);
    const key = m ? `${m[1]}/${m[2]}` : u.split("/").slice(0, 5).join("/");
    prefixes.set(key, (prefixes.get(key) || 0) + 1);
  }
  const uuid = (row.source_id.match(/[a-f0-9-]{36}/i) || [])[0];
  const withUuid = urls.filter((u) => uuid && u.includes(uuid)).length;
  console.log("\n", row.vin, row.source_id.slice(0, 70));
  console.log(" prefixes", Object.fromEntries(prefixes));
  console.log(" uuidInUrl", withUuid, "/", urls.length);
  console.log(" last3", urls.slice(-3));
  console.log(" first3", urls.slice(0, 3));
}

await c.end();
