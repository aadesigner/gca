/**
 * Diagnose why a VIN exists in prod with zero photos.
 *   VIN=KPBPH3AT1PP024362 node ./scripts/src/_tmp-vin-nophoto-diag.mjs --prod
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const VIN = (process.env.VIN || "KPBPH3AT1PP024362").trim().toUpperCase();
const PROD = process.argv.includes("--prod");

function loadUrl() {
  if (!PROD) return "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip";
  const raw = fs.readFileSync(path.join(process.env.TEMP || "/tmp", "gca-pg-vars-prod.json"), "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || "postgres")}:${encodeURIComponent(get("PGPASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const base = loadUrl();
const c = new pg.Client({ connectionString: base, ssl: PROD ? { rejectUnauthorized: false } : false });
await c.connect();
console.log({ vin: VIN, prod: PROD });

const v = (
  await c.query(
    `SELECT id, vin, make, model, year, created_at, updated_at
     FROM vehicles WHERE vin=$1`,
    [VIN],
  )
).rows[0];
console.log("vehicle", v);
if (!v) {
  await c.end();
  process.exit(1);
}

const listings = (
  await c.query(
    `
    SELECT l.id, p.internal_name, l.source_id, l.is_active, l.created_at, l.last_seen_at,
           l.mileage, left(coalesce(l.title,''), 80) AS title,
           left(coalesce(l.source_url,''), 140) AS source_url,
           (SELECT count(*)::int FROM photos ph WHERE ph.listing_id=l.id) AS listing_photos
    FROM listings l
    JOIN providers p ON p.id=l.provider_id
    WHERE l.vehicle_id=$1
    ORDER BY l.created_at DESC
    `,
    [v.id],
  )
).rows;
console.log("listings", listings);
console.log(
  "vehicle_photo_count",
  (await c.query(`SELECT count(*)::int AS n FROM photos WHERE vehicle_id=$1`, [v.id])).rows[0],
);

const photos = (
  await c.query(
    `
    SELECT ph.id, ph.listing_id, p.internal_name, ph.sort_order, ph.is_primary,
           ph.photo_group, left(ph.source_url, 140) AS src,
           left(coalesce(ph.stored_path,''), 80) AS stored
    FROM photos ph
    LEFT JOIN listings l ON l.id=ph.listing_id
    LEFT JOIN providers p ON p.id=l.provider_id
    WHERE ph.vehicle_id=$1
    ORDER BY ph.sort_order, ph.id
    LIMIT 30
    `,
    [v.id],
  )
).rows;
console.log("photos", photos);

const events = (
  await c.query(
    `
    SELECT id, event_type, left(coalesce(description,''), 100) AS description,
           occurred_at, left(coalesce(metadata::text,''), 160) AS meta
    FROM vehicle_events WHERE vehicle_id=$1
    ORDER BY occurred_at NULLS LAST, id
    LIMIT 25
    `,
    [v.id],
  )
).rows;
console.log("events", events);

try {
  const obs = (
    await c.query(
      `
      SELECT o.id, p.internal_name, o.observed_at, o.created_at,
             left(coalesce(o.source_url,''), 120) AS source_url
      FROM observations o
      LEFT JOIN providers p ON p.id=o.provider_id
      WHERE o.vehicle_id=$1
      ORDER BY o.observed_at DESC NULLS LAST, o.id DESC
      LIMIT 15
      `,
      [v.id],
    )
  ).rows;
  console.log("observations", obs);
} catch (e) {
  console.log("obs_err", e.message);
}

try {
  const extras = (
    await c.query(
      `SELECT key, left(value,80) AS value FROM vehicle_extras WHERE vehicle_id=$1 ORDER BY key LIMIT 30`,
      [v.id],
    )
  ).rows;
  console.log("extras", extras);
} catch (e) {
  console.log("extras_err", e.message);
}

await c.end();
