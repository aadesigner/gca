import pg from "pg";
const url = process.env.DATABASE_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
const row = (
  await c.query(`
    SELECT
      count(*)::int AS listings,
      count(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM photos ph
          WHERE ph.listing_id = l.id
            AND ph.stored_path ~* 'imgsv\\.getcarapi\\.com'
        )
      )::int AS with_cdn,
      count(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM photos ph
          WHERE ph.vehicle_id = l.vehicle_id
            AND ph.stored_path ~* 'imgsv\\.getcarapi\\.com'
        )
      )::int AS vehicle_has_cdn
    FROM listings l
    WHERE l.source_id LIKE 'catalog:%'
  `)
).rows[0];
console.log(JSON.stringify(row));
await c.end();
