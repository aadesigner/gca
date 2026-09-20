/**
 * Clear false Carstat mirror-failed markers, then drain onto R2 via CDP.
 * Uses vehicle-scoped batches (host ILIKE over 434k rows is too slow on Railway proxy).
 *
 *   node ./scripts/src/_ops-mirror-carstat.mjs
 *   VEHICLES=200 CONCURRENCY=2 node ./scripts/src/_ops-mirror-carstat.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: path.join(root, ".env"), override: true });

function loadProdUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const prodUrl = loadProdUrl();
process.env.DATABASE_URL = prodUrl;
process.env.PGSSLMODE = "require";
process.env.NODE_ENV = "production";

const vehicleBatches = Number(process.env.VEHICLE_BATCHES || process.env.BATCHES || "500");
const vehiclesPerBatch = Number(process.env.VEHICLES || "40");
const vehicleParallel = Number(process.env.VEHICLE_PARALLEL || "4");
const concurrency = Number(process.env.CONCURRENCY || "3");
const clearOnly = process.env.CLEAR_ONLY === "1";
const skipClear = process.env.SKIP_CLEAR === "1";

const pool = new pg.Pool({
  connectionString: prodUrl,
  max: 2,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 120_000,
});

async function countPending() {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS c FROM photos
     WHERE stored_path IS NULL AND source_url LIKE 'https://carstat.info/%'`,
  );
  return Number(rows[0]?.c ?? 0);
}

async function countFailed() {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS c FROM photos
     WHERE stored_path LIKE 'mirror-failed:%' AND source_url LIKE 'https://carstat.info/%'`,
  );
  return Number(rows[0]?.c ?? 0);
}

async function clearFailed() {
  const { rowCount } = await pool.query(
    `UPDATE photos
     SET stored_path = NULL
     WHERE source_url LIKE 'https://carstat.info/%'
       AND stored_path LIKE 'mirror-failed:%'`,
  );
  return rowCount ?? 0;
}

async function nextVehicleIds(limit) {
  const { rows } = await pool.query(
    `SELECT vehicle_id
     FROM photos
     WHERE stored_path IS NULL
       AND source_url LIKE 'https://carstat.info/%'
     GROUP BY vehicle_id
     ORDER BY max(id) DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => Number(r.vehicle_id));
}

console.log("prod_db", new URL(prodUrl.replace(/^postgresql:/i, "http:")).host);
console.log("failed before:", await countFailed());
console.log("pending before:", await countPending());
if (!skipClear) {
  console.log("cleared mirror-failed:", await clearFailed());
}
console.log("pending after clear:", await countPending());

if (clearOnly) {
  await pool.end();
  process.exit(0);
}

const { mirrorPhotos } = await import("../../artifacts/api-server/src/lib/photo-mirror.ts");

let totalUploaded = 0;
let totalFailed = 0;
let totalAttempted = 0;

for (let i = 1; i <= vehicleBatches; i++) {
  const ids = await nextVehicleIds(vehiclesPerBatch);
  if (!ids.length) {
    console.log("queue empty");
    break;
  }
  console.log(`\n=== vehicle batch ${i}/${vehicleBatches} cars=${ids.length} parallel=${vehicleParallel} ===`);
  let batchUploaded = 0;
  let batchFailed = 0;
  let batchAttempted = 0;

  async function oneVehicle(vehicleId) {
    const result = await mirrorPhotos({
      vehicleId,
      hostLike: "%carstat.info%",
      limit: 80,
      concurrency,
      maxPerVehicle: 0,
    });
    if (result.errors.length) {
      console.log(`  vehicle ${vehicleId} errors:`, result.errors.slice(0, 2));
    }
    return result;
  }

  for (let j = 0; j < ids.length; j += vehicleParallel) {
    const chunk = ids.slice(j, j + vehicleParallel);
    const results = await Promise.all(chunk.map((id) => oneVehicle(id)));
    for (const result of results) {
      batchAttempted += result.attempted;
      batchUploaded += result.uploaded + result.reused;
      batchFailed += result.failed;
    }
  }
  totalAttempted += batchAttempted;
  totalUploaded += batchUploaded;
  totalFailed += batchFailed;
  console.log(
    `batch ${i}: attempted=${batchAttempted} uploaded=${batchUploaded} failed=${batchFailed} totals u=${totalUploaded} f=${totalFailed}`,
  );
}

console.log("pending after:", await countPending());
console.log("failed after:", await countFailed());
await pool.end().catch(() => {});
process.exit(0);
