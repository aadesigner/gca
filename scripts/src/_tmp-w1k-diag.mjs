import pg from "pg";
import { pathToFileURL } from "node:url";
import path from "node:path";

const VIN = "W1KWJ8AB9PG116780";
const base = (process.env.DATABASE_URL || "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip").replace(
  /[?&]sslmode=[^&]+/i,
  "",
);
const c = new pg.Client({ connectionString: `${base}?sslmode=disable` });
await c.connect();

const v = (await c.query(`SELECT id, make, model, year FROM vehicles WHERE vin=$1`, [VIN])).rows[0];
console.log("vehicle", v);

const events = await c.query(
  `
  SELECT id, event_type, description, occurred_at,
         left(coalesce(metadata::text,''), 220) AS meta
  FROM vehicle_events
  WHERE vehicle_id=$1
    AND (
      description ILIKE '%first registration%'
      OR event_type = 'delivery'
      OR metadata::text ILIKE '%firstRegistration%'
      OR metadata::text ILIKE '%first_registration%'
    )
  ORDER BY occurred_at NULLS LAST, id
  `,
  [v.id],
);
console.log("first_reg_events", events.rows);

const photos = await c.query(
  `
  SELECT ph.id, p.internal_name, ph.listing_id, ph.sort_order, ph.is_primary,
         left(ph.source_url, 100) AS src
  FROM photos ph
  LEFT JOIN listings l ON l.id=ph.listing_id
  LEFT JOIN providers p ON p.id=l.provider_id
  WHERE ph.vehicle_id=$1 AND coalesce(ph.photo_group,'gallery')='gallery'
  ORDER BY ph.sort_order, ph.id
  LIMIT 40
  `,
  [v.id],
);
console.log("photos", photos.rows);

const { reorderVehiclePhotosForApi } = await import(
  pathToFileURL(path.resolve("artifacts/api-server/src/lib/photo-response.ts")).href
);
const raw = (
  await c.query(
    `SELECT id, source_url AS "sourceUrl", stored_path AS "storedPath",
            is_primary AS "isPrimary", sort_order AS "sortOrder",
            photo_group AS "photoGroup", listing_id AS "listingId"
     FROM photos WHERE vehicle_id=$1`,
    [v.id],
  )
).rows;
const ordered = reorderVehiclePhotosForApi(raw);
console.log(
  "api_reorder_top15",
  ordered.slice(0, 15).map((p) => ({
    sort: p.sortOrder,
    listing: p.listingId,
    src: String(p.sourceUrl).slice(-55),
  })),
);

await c.end();
