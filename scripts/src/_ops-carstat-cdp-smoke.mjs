/**
 * Prove Carstat lot-image download via CDP, then mirror one vehicle's photos.
 *   node ./scripts/src/_ops-carstat-cdp-smoke.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: path.join(root, ".env"), override: true });

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
process.env.DATABASE_URL = `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
process.env.PGSSLMODE = "require";
process.env.NODE_ENV = "production";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ssl: { rejectUnauthorized: false },
});

const { rows } = await pool.query(`
  SELECT p.id, p.vehicle_id, p.source_url
  FROM photos p
  WHERE p.source_url ILIKE '%carstat.info/api/lot-image%'
    AND p.stored_path IS NULL
  ORDER BY p.id DESC
  LIMIT 1
`);
if (!rows.length) {
  console.log("no pending carstat photo");
  await pool.end();
  process.exit(0);
}
const sample = rows[0];
console.log("sample", sample.id, sample.vehicle_id, sample.source_url.slice(0, 100));

const { carstatFetchBinaryViaCdp } = await import("../../artifacts/api-server/src/lib/providers/carstat-cdp.ts");
console.log("fetching via CDP…");
const t0 = Date.now();
try {
  const got = await carstatFetchBinaryViaCdp(sample.source_url);
  console.log("cdp ok", { bytes: got.body.length, ct: got.contentType, ms: Date.now() - t0 });
} catch (err) {
  console.error("cdp fail", err instanceof Error ? err.message : err);
  await pool.end();
  process.exit(1);
}

const { mirrorPhotos } = await import("../../artifacts/api-server/src/lib/photo-mirror.ts");
console.log("mirroring vehicle", sample.vehicle_id);
const result = await mirrorPhotos({
  vehicleId: sample.vehicle_id,
  hostLike: "%carstat.info%",
  limit: 20,
  concurrency: 1,
  maxPerVehicle: 0,
});
console.log(JSON.stringify({ ...result, errors: result.errors.slice(0, 5) }, null, 2));
await pool.end().catch(() => {});
process.exit(result.failed > 0 && result.uploaded === 0 ? 1 : 0);
