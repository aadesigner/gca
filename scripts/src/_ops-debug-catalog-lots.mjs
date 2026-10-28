import fs from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL;
const catalog = JSON.parse(
  fs.readFileSync(
    "c:/Users/Pc/.cursor/projects/c-Users-Pc-Downloads-gca/attachments/f697aa6f-10bd-47bc-bc7a-59eb19217877/getcarapi-vin-catalog-2026-10-28.json",
    "utf8",
  ),
);
const c = new pg.Client({ connectionString: url });
await c.connect();
const catalogVins = (
  await c.query(`SELECT vin FROM listings WHERE source_id LIKE 'catalog:%'`)
).rows.map((r) => r.vin);
const orig = catalog.listings.filter((l) => catalogVins.includes(l.vin));
const lots = orig.map((l) => String(l.sourceId));
const found = (
  await c.query(
    `SELECT source_id, vin, id FROM listings WHERE source_id = ANY($1::text[]) LIMIT 20`,
    [lots],
  )
).rows;
console.log(
  JSON.stringify(
    {
      catalogVins: catalogVins.length,
      orig: orig.length,
      sampleOrig: orig.slice(0, 5).map((l) => ({ vin: l.vin, sourceId: l.sourceId, url: l.sourceUrl })),
      lotsFound: found.length,
      foundSample: found.slice(0, 8),
    },
    null,
    2,
  ),
);
await c.end();
