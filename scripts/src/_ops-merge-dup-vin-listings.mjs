/**
 * Merge catalog: clones into the existing Encar listing for the same VIN.
 * Drop catalog-import cars with no Cloudflare photo.
 * Local DB only.
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
if (!/^(localhost|127\.0\.0\.1|::1)$/i.test(host) || /rlwy\.net|railway\.(app|internal)/i.test(url)) {
  throw new Error(`Refusing merge — host ${host}`);
}

const c = new pg.Client({ connectionString: url });
await c.connect();

async function absorbListing(keepId, keepVehicle, dropId, dropVehicle) {
  if (keepVehicle && dropVehicle && dropVehicle !== keepVehicle) {
    await c.query(`UPDATE photos SET vehicle_id = $1 WHERE vehicle_id = $2`, [keepVehicle, dropVehicle]);
    await c.query(`UPDATE vehicle_observations SET vehicle_id = $1 WHERE vehicle_id = $2`, [keepVehicle, dropVehicle]);
    await c.query(
      `INSERT INTO vehicle_events (vehicle_id, event_type, description, metadata, occurred_at)
       SELECT $1, event_type, description, metadata, occurred_at FROM vehicle_events WHERE vehicle_id = $2
       ON CONFLICT DO NOTHING`,
      [keepVehicle, dropVehicle],
    );
  }
  await c.query(`UPDATE photos SET listing_id = $1, vehicle_id = COALESCE($2, vehicle_id) WHERE listing_id = $3`, [
    keepId,
    keepVehicle,
    dropId,
  ]);
  await c.query(
    `UPDATE vehicle_observations SET listing_id = $1, vehicle_id = COALESCE($2, vehicle_id) WHERE listing_id = $3`,
    [keepId, keepVehicle, dropId],
  );
  await c.query(`UPDATE raw_source_records SET listing_id = $1 WHERE listing_id = $2`, [keepId, dropId]);
  await c.query(`DELETE FROM listings WHERE id = $1`, [dropId]);
  if (dropVehicle && dropVehicle !== keepVehicle) {
    await c.query(`DELETE FROM vehicle_events WHERE vehicle_id = $1`, [dropVehicle]);
    await c.query(`DELETE FROM vehicle_observations WHERE vehicle_id = $1`, [dropVehicle]);
    await c.query(`DELETE FROM photos WHERE vehicle_id = $1`, [dropVehicle]);
    await c.query(
      `DELETE FROM vehicles v WHERE v.id = $1 AND NOT EXISTS (SELECT 1 FROM listings x WHERE x.vehicle_id = v.id)`,
      [dropVehicle],
    );
  }
}

const clones = (
  await c.query(`
    SELECT
      c.id AS drop_id,
      c.vehicle_id AS drop_vehicle,
      c.vin,
      k.id AS keep_id,
      k.vehicle_id AS keep_vehicle
    FROM listings c
    JOIN listings k
      ON k.provider_id = c.provider_id
     AND k.vin = c.vin
     AND k.id <> c.id
     AND k.source_id NOT LIKE 'catalog:%'
    WHERE c.source_id LIKE 'catalog:%'
  `)
).rows;

let mergedListings = 0;
for (const row of clones) {
  await absorbListing(row.keep_id, row.keep_vehicle, row.drop_id, row.drop_vehicle);
  mergedListings++;
}

const emptyCatalog = (
  await c.query(`
    SELECT l.id, l.vehicle_id
    FROM listings l
    WHERE l.source_id LIKE 'catalog:%'
      AND NOT EXISTS (
        SELECT 1 FROM photos ph
        WHERE (ph.listing_id = l.id OR ph.vehicle_id = l.vehicle_id)
          AND ph.stored_path ~* 'imgsv\\.getcarapi\\.com'
      )
  `)
).rows;

let droppedNoCdn = 0;
for (const row of emptyCatalog) {
  await c.query(`DELETE FROM photos WHERE listing_id = $1`, [row.id]);
  await c.query(`DELETE FROM vehicle_observations WHERE listing_id = $1`, [row.id]);
  await c.query(`UPDATE raw_source_records SET listing_id = NULL WHERE listing_id = $1`, [row.id]);
  await c.query(`DELETE FROM listings WHERE id = $1`, [row.id]);
  if (row.vehicle_id) {
    await c.query(`DELETE FROM vehicle_events WHERE vehicle_id = $1 AND NOT EXISTS (SELECT 1 FROM listings x WHERE x.vehicle_id = $1)`, [
      row.vehicle_id,
    ]);
    await c.query(`DELETE FROM vehicle_observations WHERE vehicle_id = $1 AND NOT EXISTS (SELECT 1 FROM listings x WHERE x.vehicle_id = $1)`, [
      row.vehicle_id,
    ]);
    await c.query(`DELETE FROM photos WHERE vehicle_id = $1 AND NOT EXISTS (SELECT 1 FROM listings x WHERE x.vehicle_id = $1)`, [
      row.vehicle_id,
    ]);
    await c.query(
      `DELETE FROM vehicles v WHERE v.id = $1 AND NOT EXISTS (SELECT 1 FROM listings x WHERE x.vehicle_id = v.id)`,
      [row.vehicle_id],
    );
  }
  droppedNoCdn++;
}

const leftover = (
  await c.query(`SELECT count(*)::int AS n FROM listings WHERE source_id LIKE 'catalog:%'`)
).rows[0];

console.log(
  JSON.stringify({ host, matchedSameVin: clones.length, mergedListings, droppedNoCdn, leftoverCatalogListings: leftover.n }, null, 2),
);
await c.end();
