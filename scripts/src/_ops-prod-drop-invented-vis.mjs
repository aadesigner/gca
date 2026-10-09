/**
 * Drop vis.iaai.com frames that Bidscan/bid.cars invented from a lot number.
 * Those frames are a different car than the VIN.
 *
 * Walks listings by provider_id (indexed), then deletes photos by listing_id
 * (indexed). No photos-table scan. statement_timeout is 20s per statement.
 *
 *   node ./scripts/src/_ops-prod-drop-invented-vis.mjs
 * Reads %TEMP%/gca-pg-vars-prod.json (Railway variables JSON).
 */
import fs from "node:fs";
import pg from "pg";

function loadClient() {
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (name) => {
    const value = vars[name];
    return value && typeof value === "object" && "value" in value ? value.value : value;
  };
  return new pg.Client({
    host: get("RAILWAY_TCP_PROXY_DOMAIN"),
    port: Number(get("RAILWAY_TCP_PROXY_PORT") || 5432),
    user: get("PGUSER") || "postgres",
    password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
    database: get("PGDATABASE") || "railway",
    ssl: false,
    statement_timeout: 20_000,
  });
}

const client = loadClient();
await client.connect();

const providers = await client.query(
  `SELECT id, internal_name FROM providers WHERE internal_name IN ('iaa', 'bidcars') ORDER BY id`,
);
console.log("providers", providers.rows.map((row) => `${row.internal_name}:${row.id}`).join(", ") || "(none)");

let deleted = 0;
for (const provider of providers.rows) {
  let cursor = 0;
  for (let page = 0; page < 500; page++) {
    const listings = await client.query(
      `SELECT id
       FROM listings
       WHERE provider_id = $1
         AND id > $2
         AND (source_url ILIKE '%bidscan.vin%' OR source_url ILIKE '%bid.cars%')
       ORDER BY id
       LIMIT 200`,
      [provider.id, cursor],
    );
    if (listings.rows.length === 0) break;
    cursor = listings.rows[listings.rows.length - 1].id;
    const ids = listings.rows.map((row) => row.id);
    const result = await client.query(
      `DELETE FROM photos
       WHERE listing_id = ANY($1::int[])
         AND source_url ILIKE '%vis.iaai.com/resizer%'`,
      [ids],
    );
    deleted += result.rowCount;
    console.log(
      JSON.stringify({
        provider: provider.internal_name,
        page: page + 1,
        listings: ids.length,
        deleted: result.rowCount,
        total: deleted,
      }),
    );
    if (listings.rows.length < 200) break;
  }
}

const check = await client.query(
  `SELECT v.vin, count(ph.id)::int AS vis_photos
   FROM vehicles v
   LEFT JOIN photos ph
     ON ph.vehicle_id = v.id
    AND ph.source_url ILIKE '%vis.iaai.com/resizer%'
   WHERE v.vin = ANY($1::text[])
   GROUP BY v.vin
   ORDER BY v.vin`,
  [["4V4NC9TJ1DN140335", "1G6AA5RAXG0116345"]],
);
console.log("vin_check", check.rows);
console.log(JSON.stringify({ deleted }));
await client.end();
