/**
 * Remove Standvirtual rows that used invalid/fake VINs (JWT/CDN false positives).
 *   node --import ./scripts/load-env.mjs ./scripts/src/fix-standvirtual-bad-vins.mjs --prod
 *   node --import ./scripts/load-env.mjs ./scripts/src/fix-standvirtual-bad-vins.mjs --prod --apply
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pg = require("../../lib/db/node_modules/pg");

const TRANSLIT = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
function vinOk(vin) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
  if (!/[0-9X]/.test(vin[8])) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i];
    const n = /\d/.test(ch) ? Number(ch) : TRANSLIT[ch];
    if (n == null) return false;
    sum += n * WEIGHTS[i];
  }
  const cd = sum % 11;
  const expect = cd === 10 ? "X" : String(cd);
  return vin[8] === expect;
}

const apply = process.argv.includes("--apply");
const client = new pg.Client({
  host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT || 15622),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
});
await client.connect();
const pid = (await client.query(`SELECT id FROM providers WHERE internal_name='standvirtual'`)).rows[0]?.id;
const rows = await client.query(
  `
  SELECT l.id AS listing_id, l.vehicle_id, v.vin
  FROM listings l
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE l.provider_id = $1
  `,
  [pid],
);
const bad = rows.rows.filter((r) => !vinOk(String(r.vin || "").toUpperCase()));
console.log(`standvirtual listings=${rows.rows.length} bad_vin=${bad.length}`);
for (const r of bad) console.log(" ", r.vin, "listing", r.listing_id);

if (apply && bad.length) {
  const listingIds = bad.map((r) => r.listing_id);
  const vehicleIds = [...new Set(bad.map((r) => r.vehicle_id))];
  await client.query(`DELETE FROM photos WHERE listing_id = ANY($1::int[]) OR vehicle_id = ANY($2::int[])`, [
    listingIds,
    vehicleIds,
  ]);
  await client.query(`DELETE FROM listings WHERE id = ANY($1::int[])`, [listingIds]);
  // Drop vehicles only if no other listings remain
  const orphan = await client.query(
    `
    DELETE FROM vehicles v
    WHERE v.id = ANY($1::int[])
      AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.vehicle_id = v.id)
    RETURNING v.id, v.vin
    `,
    [vehicleIds],
  );
  console.log("deleted listings", listingIds.length, "orphan vehicles", orphan.rowCount);
  await client.query(`UPDATE providers SET parser_version='standvirtual-v1.0.1' WHERE id=$1`, [pid]);
} else {
  console.log(apply ? "nothing to delete" : "re-run with --apply to delete");
}
await client.end();
