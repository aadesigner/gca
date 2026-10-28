/**
 * Park dead host photos from this import and drop brand-new listings with no CDN image.
 * Local DB only. Does not delete pre-existing Encar cars.
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
  throw new Error(`Refusing prune — host ${host}`);
}

const since = "2026-10-28T15:21:00Z";
const c = new pg.Client({ connectionString: url });
await c.connect();

const ids = (
  await c.query(
    `
    SELECT id
    FROM photos
    WHERE created_at >= $1
      AND (stored_path IS NULL OR btrim(stored_path) = '')
      AND (
        source_url ILIKE '%ibb.co%'
        OR source_url ILIKE '%postimg.cc%'
        OR source_url ILIKE '%carstat.dev%'
        OR source_url ILIKE '%carstat.info%'
      )
    `,
    [since],
  )
).rows.map((r) => r.id);
console.log(JSON.stringify({ parkedCandidates: ids.length }));

let parked = 0;
for (let i = 0; i < ids.length; i += 200) {
  const chunk = ids.slice(i, i + 200);
  const res = await c.query(
    `UPDATE photos SET stored_path = 'mirror-failed:' || id::text WHERE id = ANY($1::int[]) AND (stored_path IS NULL OR btrim(stored_path) = '')`,
    [chunk],
  );
  parked += res.rowCount;
}

const emptyNew = (
  await c.query(
    `
    SELECT l.id, l.vehicle_id
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    WHERE p.internal_name = 'encar'
      AND l.created_at >= $1
      AND NOT EXISTS (
        SELECT 1 FROM photos ph
        WHERE ph.listing_id = l.id
          AND ph.stored_path ~* 'imgsv\\.getcarapi\\.com'
      )
    `,
    [since],
  )
).rows;
const listingIds = emptyNew.map((r) => r.id);
const vehicleIds = [...new Set(emptyNew.map((r) => r.vehicle_id).filter(Boolean))];
console.log(JSON.stringify({ emptyNewListings: listingIds.length }));

if (listingIds.length) {
  await c.query(`DELETE FROM photos WHERE listing_id = ANY($1::int[])`, [listingIds]);
  await c.query(`DELETE FROM vehicle_observations WHERE listing_id = ANY($1::int[])`, [listingIds]);
  await c.query(`DELETE FROM listings WHERE id = ANY($1::int[])`, [listingIds]);
}

let deletedVehicles = 0;
if (vehicleIds.length) {
  const orphans = (
    await c.query(
      `
      SELECT v.id FROM vehicles v
      WHERE v.id = ANY($1::int[])
        AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.vehicle_id = v.id)
      `,
      [vehicleIds],
    )
  ).rows.map((r) => r.id);
  if (orphans.length) {
    await c.query(`DELETE FROM vehicle_events WHERE vehicle_id = ANY($1::int[])`, [orphans]);
    await c.query(`DELETE FROM vehicle_observations WHERE vehicle_id = ANY($1::int[])`, [orphans]);
    await c.query(`DELETE FROM photos WHERE vehicle_id = ANY($1::int[])`, [orphans]);
    deletedVehicles = (await c.query(`DELETE FROM vehicles WHERE id = ANY($1::int[])`, [orphans])).rowCount;
  }
}

const kept = (
  await c.query(
    `
    SELECT
      count(DISTINCT l.id)::int AS listings,
      count(ph.id)::int AS cdn_photos
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    JOIN photos ph ON ph.listing_id = l.id
    WHERE p.internal_name = 'encar'
      AND l.updated_at >= $1
      AND ph.stored_path ~* 'imgsv\\.getcarapi\\.com'
    `,
    [since],
  )
).rows[0];

console.log(JSON.stringify({ host, parked, emptyNew: listingIds.length, deletedVehicles, kept }, null, 2));
await c.end();
