/**
 * Delete bad EU marketplace rows that need re-crawl after parser fixes.
 * - standvirtual: fake JWT VINs + null years
 * - mobilebg: garbled charset → wrong year/mileage/price
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/fix-eu-qa-bad-rows.mjs --prod
 *   node --import ./scripts/load-env.mjs ./scripts/src/fix-eu-qa-bad-rows.mjs --prod --apply
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pg = require("../../lib/db/node_modules/pg");

const apply = process.argv.includes("--apply");
const client = new pg.Client({
  host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT || 15622),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
});
await client.connect();

async function purgeProvider(name, reason) {
  const pid = (await client.query(`SELECT id FROM providers WHERE internal_name=$1`, [name])).rows[0]?.id;
  if (!pid) {
    console.log(name, "missing");
    return;
  }
  const rows = await client.query(
    `SELECT l.id AS listing_id, l.vehicle_id, v.vin, v.year, l.price_amount, l.mileage
     FROM listings l JOIN vehicles v ON v.id=l.vehicle_id WHERE l.provider_id=$1`,
    [pid],
  );
  console.log(`\n${name}: ${rows.rowCount} listings (${reason})`);
  for (const r of rows.rows.slice(0, 5)) {
    console.log(" ", r.vin, "year=", r.year, "km=", r.mileage, "price=", r.price_amount);
  }
  if (!apply || !rows.rowCount) return;
  const listingIds = rows.rows.map((r) => r.listing_id);
  const vehicleIds = [...new Set(rows.rows.map((r) => r.vehicle_id))];
  await client.query(`DELETE FROM vehicle_observations WHERE listing_id = ANY($1::int[]) OR vehicle_id = ANY($2::int[])`, [
    listingIds,
    vehicleIds,
  ]);
  await client.query(`DELETE FROM vehicle_events WHERE vehicle_id = ANY($1::int[])`, [vehicleIds]);
  await client.query(`DELETE FROM photos WHERE listing_id = ANY($1::int[]) OR vehicle_id = ANY($2::int[])`, [
    listingIds,
    vehicleIds,
  ]);
  await client.query(`DELETE FROM listings WHERE id = ANY($1::int[])`, [listingIds]);
  const orphan = await client.query(
    `DELETE FROM vehicles v
     WHERE v.id = ANY($1::int[])
       AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.vehicle_id = v.id)
     RETURNING v.id`,
    [vehicleIds],
  );
  console.log(" deleted listings", listingIds.length, "orphan vehicles", orphan.rowCount);
}

await purgeProvider("standvirtual", "fake VINs / null years from old parser");
await purgeProvider("mobilebg", "windows-1251 misread → bad year/km/price");
await purgeProvider("autoscout24_be", "missing priceRaw parse — refresh with fixed parser");
await purgeProvider("autotradernl", "missing priceRaw parse — refresh with fixed parser");

// Also null out AS24 BE/NL prices aren't deletable — leave for refresh; optional wipe thin sets
if (apply) {
  await client.query(`UPDATE providers SET parser_version='standvirtual-v1.0.2' WHERE internal_name='standvirtual'`);
  await client.query(`UPDATE providers SET parser_version='mobilebg-v1.0.2' WHERE internal_name='mobilebg'`);
  await client.query(`UPDATE providers SET parser_version='autoscout24_be-v1.0.1' WHERE internal_name='autoscout24_be'`);
  await client.query(`UPDATE providers SET parser_version='autotradernl-v1.0.1' WHERE internal_name='autotradernl'`);
  await client.query(`UPDATE providers SET parser_version='subito-v1.0.1' WHERE internal_name='subito'`);
  console.log("\nparser_version bumps applied");
} else {
  console.log("\nre-run with --apply to delete + bump parser_version");
}
await client.end();
