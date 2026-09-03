/**
 * Copy Seobuk photo URLs from production → local for overlapping VINs.
 */
import pg from "pg";

const local = new pg.Client({
  connectionString: process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL,
  connectionTimeoutMillis: 15_000,
});
const prod = new pg.Client({
  host: process.env.PROD_PG_HOST ?? "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT ?? "15622"),
  user: process.env.PROD_PG_USER ?? "postgres",
  password: process.env.PGPASSWORD || process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE ?? "railway",
  ssl: false,
  connectionTimeoutMillis: 20_000,
});

await local.connect();
await prod.connect();

const localRows = await local.query(`
  SELECT l.id AS listing_id, l.vehicle_id, v.vin, count(ph.id)::int AS photos
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  LEFT JOIN photos ph ON ph.listing_id = l.id
  WHERE p.internal_name = 'seobuk'
  GROUP BY l.id, l.vehicle_id, v.vin
`);
console.log("local seobuk", localRows.rows.length);

let added = 0;
let touched = 0;
for (const row of localRows.rows) {
  const prodPhotos = await prod.query(
    `
    SELECT ph.source_url, ph.is_primary, ph.sort_order, ph.width, ph.height
    FROM photos ph
    JOIN listings l ON l.id = ph.listing_id
    JOIN providers p ON p.id = l.provider_id
    JOIN vehicles v ON v.id = ph.vehicle_id
    WHERE p.internal_name = 'seobuk' AND v.vin = $1
    ORDER BY ph.sort_order, ph.id
  `,
    [row.vin],
  );
  if (prodPhotos.rows.length <= row.photos) continue;
  touched++;
  for (const photo of prodPhotos.rows) {
    const ins = await local.query(
      `
      INSERT INTO photos (vehicle_id, listing_id, source_url, is_primary, sort_order, width, height, photo_group)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'gallery')
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
      [
        row.vehicle_id,
        row.listing_id,
        photo.source_url,
        photo.is_primary,
        photo.sort_order,
        photo.width,
        photo.height,
      ],
    );
    if (ins.rowCount) added++;
  }
  console.log(row.vin, `local ${row.photos} → prod ${prodPhotos.rows.length}`);
}

console.log("Done. touched", touched, "photos added", added);
await local.end();
await prod.end();
