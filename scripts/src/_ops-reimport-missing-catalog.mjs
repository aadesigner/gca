/**
 * Re-import catalog VINs that were overwritten by a shared Encar sourceId.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-reimport-missing-catalog.mjs
 */
import fs from "node:fs";
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

const catalogPath =
  "c:/Users/Pc/.cursor/projects/c-Users-Pc-Downloads-gca/attachments/f697aa6f-10bd-47bc-bc7a-59eb19217877/getcarapi-vin-catalog-2026-10-28.json";
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const vins = catalog.listings.map((l) => l.vin);

const db = new pg.Client({ connectionString: url });
await db.connect();
const present = new Set(
  (
    await db.query(
      `SELECT DISTINCT COALESCE(v.vin, l.vin) AS vin
       FROM listings l JOIN vehicles v ON v.id = l.vehicle_id
       WHERE l.vin = ANY($1::text[]) OR v.vin = ANY($1::text[])`,
      [vins],
    )
  ).rows.map((r) => r.vin),
);
await db.end();

const missing = catalog.listings
  .filter((l) => !present.has(l.vin))
  .map((l) => ({
    ...l,
    sourceId: `catalog:${l.vin}`,
    sourceUrl: l.sourceUrl || `https://fem.encar.com/cars/detail/${l.sourceId}`,
  }));

const out =
  "c:/Users/Pc/.cursor/projects/c-Users-Pc-Downloads-gca/attachments/f697aa6f-10bd-47bc-bc7a-59eb19217877/getcarapi-vin-catalog-missing.json";
fs.writeFileSync(
  out,
  JSON.stringify({
    format: "getcarapi-vin-catalog",
    version: 1,
    exportedAt: new Date().toISOString(),
    listings: missing,
  }),
);
console.log(JSON.stringify({ present: present.size, missing: missing.length, out }));
