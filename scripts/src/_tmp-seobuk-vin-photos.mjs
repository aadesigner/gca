import pg from "pg";

const c = new pg.Client({
  host: process.env.PROD_PG_HOST ?? "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT ?? "15622"),
  user: process.env.PROD_PG_USER ?? "postgres",
  password: process.env.PGPASSWORD || process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE ?? "railway",
  ssl: false,
  connectionTimeoutMillis: 20_000,
});
await c.connect();
const vin = process.argv[2] || "1C4PJMDU7GW249001";
const rows = await c.query(
  `
  SELECT ph.source_url, ph.stored_path, ph.sort_order, l.source_id
  FROM photos ph
  JOIN vehicles v ON v.id = ph.vehicle_id
  LEFT JOIN listings l ON l.id = ph.listing_id
  WHERE v.vin = $1
  ORDER BY ph.sort_order, ph.id
`,
  [vin],
);
console.log(vin, "photos", rows.rows.length);
for (const r of rows.rows) console.log(r.sort_order, r.source_url);
await c.end();
