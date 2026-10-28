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

const catalog = JSON.parse(
  fs.readFileSync(
    "c:/Users/Pc/.cursor/projects/c-Users-Pc-Downloads-gca/attachments/f697aa6f-10bd-47bc-bc7a-59eb19217877/getcarapi-vin-catalog-2026-10-28.json",
    "utf8",
  ),
);
const vins = catalog.listings.map((l) => l.vin);
const c = new pg.Client({ connectionString: url });
await c.connect();
const row = (
  await c.query(
    `
    SELECT
      count(DISTINCT COALESCE(v.vin, l.vin))::int AS vins_in_db,
      count(DISTINCT COALESCE(v.vin, l.vin)) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM photos ph
          WHERE ph.vehicle_id = v.id
            AND ph.stored_path ~* 'imgsv\\.getcarapi\\.com'
        )
      )::int AS vins_with_cdn
    FROM listings l
    JOIN vehicles v ON v.id = l.vehicle_id
    WHERE l.vin = ANY($1::text[]) OR v.vin = ANY($1::text[])
    `,
    [vins],
  )
).rows[0];
const extras = (
  await c.query(
    `
    SELECT
      (SELECT count(*)::int FROM vehicle_events ve
         JOIN vehicles v ON v.id = ve.vehicle_id
        WHERE v.vin = ANY($1::text[])) AS events,
      (SELECT count(*)::int FROM photos ph
         JOIN vehicles v ON v.id = ph.vehicle_id
        WHERE v.vin = ANY($1::text[])
          AND ph.stored_path ~* 'imgsv\\.getcarapi\\.com') AS cdn_photos
    `,
    [vins],
  )
).rows[0];
const present = (
  await c.query(
    `SELECT DISTINCT COALESCE(v.vin, l.vin) AS vin
     FROM listings l JOIN vehicles v ON v.id = l.vehicle_id
     WHERE l.vin = ANY($1::text[]) OR v.vin = ANY($1::text[])`,
    [vins],
  )
).rows.map((r) => r.vin);
const missing = vins.filter((v) => !present.includes(v));
console.log(
  JSON.stringify(
    {
      catalog: vins.length,
      host,
      ...row,
      ...extras,
      missing: missing.length,
      missingSample: missing.slice(0, 8),
    },
    null,
    2,
  ),
);
await c.end();
