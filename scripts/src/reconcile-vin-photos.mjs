/**
 * Reconcile vehicle photo galleries — keep one canonical listing per VIN.
 * Run: pnpm exec tsx --import ./scripts/load-env.mjs ./scripts/src/reconcile-vin-photos.mjs [vin]
 */
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const onlyVin = process.argv[2]?.trim().toUpperCase();

const { reconcileVehiclePhotos } = await import(
  "../../artifacts/api-server/src/lib/collector/pipeline.ts"
);

let vehicleIds = [];
if (onlyVin) {
  const { rows } = await pool.query(`SELECT id FROM vehicles WHERE vin = $1`, [onlyVin]);
  if (!rows[0]) {
    console.error("VIN not found:", onlyVin);
    await pool.end();
    process.exit(1);
  }
  vehicleIds = [rows[0].id];
} else {
  const { rows } = await pool.query(`
    SELECT ph.vehicle_id AS id, count(DISTINCT ph.listing_id)::int AS listings
    FROM photos ph
    GROUP BY ph.vehicle_id
    HAVING count(DISTINCT ph.listing_id) > 1
    ORDER BY listings DESC
  `);
  vehicleIds = rows.map((r) => r.id);
  console.log(`Reconciling ${vehicleIds.length} vehicles with mixed listing photos…`);
}

let changed = 0;
for (let i = 0; i < vehicleIds.length; i++) {
  const id = vehicleIds[i];
  const { before, after } = await reconcileVehiclePhotos(id);
  if (before !== after) {
    changed++;
    if (onlyVin || i < 20) console.log(`vehicle ${id}: ${before} → ${after} photos`);
  }
  if ((i + 1) % 500 === 0) console.log(`  …${i + 1}/${vehicleIds.length}`);
}

console.log(`Done. ${changed} vehicles trimmed.`);
await pool.end();
