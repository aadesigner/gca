/**
 * Reconcile VIN gallery sort order for one or many vehicles (heals random/overflow scramble).
 *
 *   VIN=WBS3C910XFP708160 node scripts/src/_tmp-heal-photo-order.mjs
 *   LIMIT=200 node scripts/src/_tmp-heal-photo-order.mjs
 */
import { pathToFileURL } from "node:url";
import path from "node:path";

process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";

// Load compiled reconcile from api-server source via tsx when available.
const { reconcileVehiclePhotos } = await import(
  pathToFileURL(
    path.resolve("artifacts/api-server/src/lib/collector/pipeline.ts"),
  ).href
);
const pg = (await import("pg")).default;

const VIN = process.env.VIN || "";
const LIMIT = Number(process.env.LIMIT || 100);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

let ids = [];
if (VIN) {
  const row = (await c.query(`SELECT id FROM vehicles WHERE vin=$1`, [VIN])).rows[0];
  if (!row) {
    console.log("vin_missing", VIN);
    await c.end();
    process.exit(1);
  }
  ids = [row.id];
} else {
  // Prefer vehicles that look scrambled (overflow or multi-listing).
  const rows = await c.query(
    `
    SELECT v.id
    FROM vehicles v
    WHERE EXISTS (
      SELECT 1 FROM photos p
      WHERE p.vehicle_id = v.id
        AND coalesce(p.photo_group,'gallery') = 'gallery'
        AND p.sort_order >= 10000
    )
    ORDER BY v.id DESC
    LIMIT $1
    `,
    [LIMIT],
  );
  ids = rows.rows.map((r) => r.id);
}

console.log("reconciling", ids.length, "vehicles");
let ok = 0;
for (const id of ids) {
  try {
    const r = await reconcileVehiclePhotos(id);
    ok++;
    if (ok <= 5 || VIN) console.log("healed", id, r);
  } catch (e) {
    console.error("fail", id, String(e.message || e));
  }
}
console.log("done", { ok, total: ids.length });
await c.end();
