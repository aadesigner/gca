/**
 * Catalog listings (source_id catalog:VIN) that already exist as Encar cars
 * by Encar lot id or near VIN.
 */
import pg from "pg";

const url = process.env.DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(url.replace(/^postgres(ql)?:/i, "http:")).hostname;
  } catch {
    return "";
  }
})();
if (!/^(localhost|127\.0\.0\.1|::1)$/i.test(host)) throw new Error(host);

const c = new pg.Client({ connectionString: url });
await c.connect();

const rows = (
  await c.query(`
    SELECT
      l.id AS catalog_listing_id,
      l.vin AS catalog_vin,
      l.vehicle_id AS catalog_vehicle_id,
      l.source_url,
      substring(l.source_url from '/cars/detail/([0-9]+)') AS encar_id,
      e.id AS encar_listing_id,
      e.vin AS encar_vin,
      e.vehicle_id AS encar_vehicle_id
    FROM listings l
    LEFT JOIN listings e
      ON e.provider_id = l.provider_id
     AND e.source_id = substring(l.source_url from '/cars/detail/([0-9]+)')
     AND e.id <> l.id
    WHERE l.source_id LIKE 'catalog:%'
  `)
).rows;

const overlap = rows.filter((r) => r.encar_listing_id);
const vinMismatch = overlap.filter((r) => r.catalog_vin && r.encar_vin && r.catalog_vin !== r.encar_vin);
const sameVin = overlap.filter((r) => r.catalog_vin && r.encar_vin && r.catalog_vin === r.encar_vin);
const noMatch = rows.filter((r) => !r.encar_listing_id);

console.log(
  JSON.stringify(
    {
      host,
      catalog: rows.length,
      overlap: overlap.length,
      sameVin: sameVin.length,
      vinMismatch: vinMismatch.length,
      vinMismatchSample: vinMismatch.slice(0, 12).map((r) => ({
        catalogVin: r.catalog_vin,
        encarVin: r.encar_vin,
        encarId: r.encar_id,
        catalogVehicle: r.catalog_vehicle_id,
        encarVehicle: r.encar_vehicle_id,
      })),
      noMatch: noMatch.length,
    },
    null,
    2,
  ),
);
await c.end();
