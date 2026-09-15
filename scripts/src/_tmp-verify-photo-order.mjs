import pg from "pg";
import { pathToFileURL } from "node:url";
import path from "node:path";

const VIN = process.env.VIN || "WBS3C910XFP708160";
const base = (process.env.DATABASE_URL || "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip").replace(
  /[?&]sslmode=[^&]+/i,
  "",
);

const { reorderVehiclePhotosForApi } = await import(
  pathToFileURL(path.resolve("artifacts/api-server/src/lib/photo-response.ts")).href
);

const c = new pg.Client({ connectionString: `${base}?sslmode=disable` });
await c.connect();
const v = (await c.query(`SELECT id FROM vehicles WHERE vin=$1`, [VIN])).rows[0];
const photos = (
  await c.query(
    `
    SELECT id, source_url AS "sourceUrl", stored_path AS "storedPath",
           is_primary AS "isPrimary", sort_order AS "sortOrder",
           photo_group AS "photoGroup", listing_id AS "listingId"
    FROM photos WHERE vehicle_id=$1
    ORDER BY sort_order, id
    `,
    [v.id],
  )
).rows;

console.log("before_top12");
for (const p of photos.slice(0, 12)) {
  console.log(p.sortOrder, p.listingId, String(p.sourceUrl).slice(-60));
}

const ordered = reorderVehiclePhotosForApi(photos);
console.log("\nafter_api_reorder_top20");
for (const p of ordered.slice(0, 20)) {
  console.log(p.sortOrder, p.listingId, String(p.sourceUrl).slice(-60));
}

// Persist healed VIN-facing order + overflow parking.
const { reconcileVehiclePhotos } = await import(
  pathToFileURL(path.resolve("artifacts/api-server/src/lib/collector/pipeline.ts")).href
);
const r = await reconcileVehiclePhotos(v.id);
console.log("\nreconcile", r);

const after = (
  await c.query(
    `
    SELECT sort_order, listing_id, right(source_url, 60) AS src
    FROM photos WHERE vehicle_id=$1 AND coalesce(photo_group,'gallery')='gallery'
    ORDER BY sort_order, id LIMIT 25
    `,
    [v.id],
  )
).rows;
console.log("\ndb_after");
for (const p of after) console.log(p.sort_order, p.listing_id, p.src);
await c.end();
