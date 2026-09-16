/**
 * Fast prod heal: SQL-targeted duplicate first-regs + photo reconcile for multi-listing VINs.
 *   pnpm --filter @workspace/scripts exec tsx --import ./load-env.mjs ./src/_tmp-heal-firstreg-photos-fast.mjs --prod
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const PROD = process.argv.includes("--prod");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIMIT = Number(process.env.LIMIT || 8000) || 8000;

function loadProdUrl() {
  const p = path.join(process.env.TEMP || "/tmp", "gca-pg-vars-prod.json");
  const raw = fs.readFileSync(p, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => {
    const v = vars[n];
    return v && typeof v === "object" && "value" in v ? v.value : v;
  };
  return `postgresql://${encodeURIComponent(get("PGUSER") || "postgres")}:${encodeURIComponent(get("PGPASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const base = PROD
  ? loadProdUrl()
  : "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip";
process.env.DATABASE_URL = `${base}${base.includes("?") ? "&" : "?"}sslmode=disable`;

const {
  isFirstRegistrationEvent,
  pickBestFirstRegistration,
  firstRegistrationValue,
} = await import(pathToFileURL(path.join(ROOT, "artifacts/api-server/src/lib/providers/web-html.ts")).href);
const { reconcileVehiclePhotos } = await import(
  pathToFileURL(path.join(ROOT, "artifacts/api-server/src/lib/collector/pipeline.ts")).href
);

const c = new pg.Client({ connectionString: base, ssl: PROD ? { rejectUnauthorized: false } : false });
await c.connect();
console.log({ prod: PROD, limit: LIMIT });

// Only vehicles with 2+ first-reg-like delivery/other rows.
const dupVehicles = (
  await c.query(
    `
    SELECT v.id, v.vin, count(*)::int AS n
    FROM vehicles v
    JOIN vehicle_events e ON e.vehicle_id = v.id
    WHERE e.event_type IN ('delivery','other')
      AND (
        e.description ILIKE '%first registration%'
        OR e.metadata::text ILIKE '%firstRegistration%'
        OR e.metadata::text ILIKE '%firstDate%'
        OR e.metadata::text ILIKE '%"productionYear"%'
      )
    GROUP BY v.id, v.vin
    HAVING count(*) >= 2
    ORDER BY n DESC, v.id
    LIMIT $1
    `,
    [LIMIT],
  )
).rows;
console.log("dup_firstreg_candidates", dupVehicles.length);

let firstFixed = 0;
for (const v of dupVehicles) {
  const rows = (
    await c.query(
      `SELECT id, event_type AS "eventType", description, metadata, occurred_at AS "occurredAt"
       FROM vehicle_events WHERE vehicle_id=$1 AND event_type IN ('delivery','other') ORDER BY id`,
      [v.id],
    )
  ).rows;
  const firstRegs = rows.filter((r) =>
    isFirstRegistrationEvent({ eventType: r.eventType, description: r.description, metadata: r.metadata }),
  );
  if (firstRegs.length < 2) continue;
  const best = pickBestFirstRegistration(firstRegs);
  if (!best) continue;
  const value =
    firstRegistrationValue(best) ||
    (String(best.description || "").match(/First registration:\s*(.+)$/i)?.[1] ?? "").trim();
  await c.query(`DELETE FROM vehicle_events WHERE id = ANY($1::int[])`, [firstRegs.map((r) => r.id)]);
  let metaObj = {};
  try {
    metaObj =
      typeof best.metadata === "string"
        ? JSON.parse(best.metadata || "{}")
        : best.metadata && typeof best.metadata === "object"
          ? best.metadata
          : {};
  } catch {
    metaObj = {};
  }
  metaObj.kind = "firstRegistration";
  metaObj.field = metaObj.field || "firstRegistration";
  if (value && !metaObj.value) metaObj.value = value;
  await c.query(
    `INSERT INTO vehicle_events (vehicle_id, event_type, description, metadata, occurred_at)
     VALUES ($1,'delivery',$2,$3::jsonb,$4) ON CONFLICT DO NOTHING`,
    [v.id, value ? `First registration: ${value}` : best.description, JSON.stringify(metaObj), best.occurredAt || new Date()],
  );
  firstFixed++;
  if (firstFixed <= 25 || firstFixed % 200 === 0) {
    console.log("firstreg_fixed", firstFixed, v.vin, value);
  }
}
console.log("firstreg_summary", { candidates: dupVehicles.length, fixed: firstFixed });

const photoVehicles = (
  await c.query(
    `
    SELECT v.id, v.vin
    FROM vehicles v
    WHERE (
      SELECT count(DISTINCT ph.listing_id) FROM photos ph
      WHERE ph.vehicle_id=v.id AND ph.listing_id IS NOT NULL
        AND coalesce(ph.photo_group,'gallery')='gallery'
    ) >= 2
    ORDER BY v.id
    LIMIT $1
    `,
    [LIMIT],
  )
).rows;
console.log("photo_candidates", photoVehicles.length);

let photoFixed = 0;
for (const v of photoVehicles) {
  try {
    await reconcileVehiclePhotos(v.id, { skipMirror: true });
    photoFixed++;
    if (photoFixed <= 10 || photoFixed % 200 === 0) {
      console.log("photos_reconciled", photoFixed, "/", photoVehicles.length, v.vin);
    }
  } catch (err) {
    console.error("photos_fail", v.vin, err?.message || err);
  }
}
console.log("photos_summary", { scanned: photoVehicles.length, fixed: photoFixed });

// Spot-check W1K
const w1k = (await c.query(`SELECT id FROM vehicles WHERE vin='W1KWJ8AB9PG116780'`)).rows[0];
if (w1k) {
  const ev = await c.query(
    `SELECT event_type, description FROM vehicle_events
     WHERE vehicle_id=$1 AND description ILIKE '%first registration%' AND event_type='delivery'`,
    [w1k.id],
  );
  const ph = await c.query(
    `SELECT sort_order, right(source_url,50) AS src FROM photos
     WHERE vehicle_id=$1 AND coalesce(photo_group,'gallery')='gallery'
     ORDER BY sort_order LIMIT 8`,
    [w1k.id],
  );
  console.log("w1k_firstreg", ev.rows);
  console.log("w1k_photos", ph.rows);
}

await c.end();
console.log("done");
