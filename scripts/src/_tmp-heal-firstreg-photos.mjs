/**
 * Fleet heal:
 *  1) Collapse duplicate first-registration events → one delivery (day+month wins)
 *  2) Reconcile VIN gallery order (Encar/marketplace before BidDrive mirrors)
 *
 *   node ./scripts/src/_tmp-heal-firstreg-photos.mjs
 *   node ./scripts/src/_tmp-heal-firstreg-photos.mjs --prod
 *   VIN=W1KWJ8AB9PG116780 node ./scripts/src/_tmp-heal-firstreg-photos.mjs --prod
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const PROD = process.argv.includes("--prod");
const ONLY_VIN = (process.env.VIN || "").trim().toUpperCase() || null;
const LIMIT = Number(process.env.LIMIT || (ONLY_VIN ? 1 : 5000)) || 5000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function loadDbUrl() {
  if (process.env.DATABASE_URL && !PROD) return process.env.DATABASE_URL;
  if (PROD) {
    const p = path.join(process.env.TEMP || "/tmp", "gca-pg-vars-prod.json");
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw.slice(raw.indexOf("{")));
    const vars = j.variables || j;
    const get = (n) => {
      const v = vars[n];
      return v && typeof v === "object" && "value" in v ? v.value : v;
    };
    const host = get("RAILWAY_TCP_PROXY_DOMAIN");
    const port = get("RAILWAY_TCP_PROXY_PORT");
    const user = get("PGUSER") || get("POSTGRES_USER") || "postgres";
    const pass = get("PGPASSWORD") || get("POSTGRES_PASSWORD");
    const db = get("PGDATABASE") || get("POSTGRES_DB") || "railway";
    if (host && port && pass) {
      return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}`;
    }
    return get("DATABASE_URL") || vars.DATABASE_URL || vars.databaseUrl || vars.url;
  }
  return "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip";
}

const rawUrl = loadDbUrl();
const base = String(rawUrl).replace(/[?&]sslmode=[^&]+/i, "");
const connectionString = `${base}${base.includes("?") ? "&" : "?"}sslmode=disable`;

// App DB pool reads DATABASE_URL at import time.
process.env.DATABASE_URL = connectionString;

const {
  isFirstRegistrationEvent,
  pickBestFirstRegistration,
  firstRegistrationValue,
} = await import(
  pathToFileURL(path.join(ROOT, "artifacts/api-server/src/lib/providers/web-html.ts")).href
);
const { reconcileVehiclePhotos } = await import(
  pathToFileURL(path.join(ROOT, "artifacts/api-server/src/lib/collector/pipeline.ts")).href
);

const c = new pg.Client({
  connectionString: base,
  ssl: PROD ? { rejectUnauthorized: false } : false,
});
await c.connect();
console.log({ prod: PROD, onlyVin: ONLY_VIN, limit: LIMIT, host: base.replace(/:[^:@]+@/, ":****@").slice(0, 80) });

async function healFirstRegs() {
  const vehicles = ONLY_VIN
    ? (await c.query(`SELECT id, vin FROM vehicles WHERE vin=$1`, [ONLY_VIN])).rows
    : (
        await c.query(
          `
          SELECT v.id, v.vin
          FROM vehicles v
          WHERE EXISTS (
            SELECT 1 FROM vehicle_events e
            WHERE e.vehicle_id = v.id
              AND (
                e.description ILIKE '%first registration%'
                OR e.metadata::text ILIKE '%firstRegistration%'
                OR e.metadata::text ILIKE '%firstDate%'
                OR e.event_type IN ('delivery','other')
              )
          )
          ORDER BY v.id
          LIMIT $1
          `,
          [LIMIT],
        )
      ).rows;

  let scanned = 0;
  let fixed = 0;
  let kept = 0;
  for (const v of vehicles) {
    scanned++;
    const rows = (
      await c.query(
        `
        SELECT id, event_type AS "eventType", description, metadata, occurred_at AS "occurredAt"
        FROM vehicle_events
        WHERE vehicle_id = $1
          AND event_type IN ('delivery', 'other')
        ORDER BY id
        `,
        [v.id],
      )
    ).rows;

    const firstRegs = rows.filter((r) =>
      isFirstRegistrationEvent({
        eventType: r.eventType,
        description: r.description,
        metadata: r.metadata,
      }),
    );
    if (firstRegs.length === 0) continue;
    if (firstRegs.length === 1 && firstRegs[0].eventType === "delivery") {
      // Normalize description if missing day precision label already ok
      kept++;
      continue;
    }

    const best = pickBestFirstRegistration(firstRegs);
    if (!best) continue;
    const value =
      firstRegistrationValue(best) ||
      (String(best.description || "").match(/First registration:\s*(.+)$/i)?.[1] ?? "").trim();
    const dropIds = firstRegs.map((r) => r.id);
    await c.query(`DELETE FROM vehicle_events WHERE id = ANY($1::int[])`, [dropIds]);

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
      `
      INSERT INTO vehicle_events (vehicle_id, event_type, description, metadata, occurred_at)
      VALUES ($1, 'delivery', $2, $3::jsonb, $4)
      ON CONFLICT DO NOTHING
      `,
      [
        v.id,
        value ? `First registration: ${value}` : best.description,
        JSON.stringify(metaObj),
        best.occurredAt || new Date(),
      ],
    );
    fixed++;
    if (fixed <= 20 || v.vin === ONLY_VIN) {
      console.log("firstreg_fixed", v.vin, { from: firstRegs.length, keep: value || best.description });
    }
  }
  return { scanned, fixed, kept };
}

async function healPhotos() {
  const vehicles = ONLY_VIN
    ? (await c.query(`SELECT id, vin FROM vehicles WHERE vin=$1`, [ONLY_VIN])).rows
    : (
        await c.query(
          `
          SELECT v.id, v.vin
          FROM vehicles v
          WHERE (
            SELECT count(DISTINCT ph.listing_id) FROM photos ph
            WHERE ph.vehicle_id = v.id AND ph.listing_id IS NOT NULL
              AND coalesce(ph.photo_group,'gallery') = 'gallery'
          ) >= 2
          OR EXISTS (
            SELECT 1 FROM photos ph
            WHERE ph.vehicle_id = v.id
              AND ph.sort_order >= 10000
              AND coalesce(ph.photo_group,'gallery') = 'gallery'
          )
          OR EXISTS (
            SELECT 1 FROM photos ph
            JOIN listings l ON l.id = ph.listing_id
            JOIN providers p ON p.id = l.provider_id
            WHERE ph.vehicle_id = v.id
              AND p.internal_name = 'thebidrive'
              AND ph.is_primary = true
          )
          ORDER BY v.id
          LIMIT $1
          `,
          [LIMIT],
        )
      ).rows;

  let scanned = 0;
  let fixed = 0;
  for (const v of vehicles) {
    scanned++;
    try {
      const r = await reconcileVehiclePhotos(v.id, { skipMirror: true });
      fixed++;
      if (fixed <= 15 || v.vin === ONLY_VIN || fixed % 100 === 0) {
        console.log("photos_reconciled", fixed, "/", vehicles.length, v.vin, r);
      }
    } catch (err) {
      console.error("photos_fail", v.vin, err?.message || err);
    }
  }
  return { scanned, fixed };
}

const first = await healFirstRegs();
console.log("firstreg_summary", first);
const photos = await healPhotos();
console.log("photos_summary", photos);

if (ONLY_VIN) {
  const v = (await c.query(`SELECT id FROM vehicles WHERE vin=$1`, [ONLY_VIN])).rows[0];
  if (v) {
    const ev = await c.query(
      `
      SELECT event_type, description, left(coalesce(metadata::text,''), 160) AS meta
      FROM vehicle_events
      WHERE vehicle_id=$1
        AND (description ILIKE '%first registration%' OR event_type='delivery'
             OR metadata::text ILIKE '%firstDate%' OR metadata::text ILIKE '%firstRegistration%')
      ORDER BY id
      `,
      [v.id],
    );
    console.log("verify_firstreg", ev.rows);
    const ph = await c.query(
      `
      SELECT ph.sort_order, p.internal_name, right(ph.source_url, 55) AS src
      FROM photos ph
      LEFT JOIN listings l ON l.id=ph.listing_id
      LEFT JOIN providers p ON p.id=l.provider_id
      WHERE ph.vehicle_id=$1 AND coalesce(ph.photo_group,'gallery')='gallery'
      ORDER BY ph.sort_order, ph.id
      LIMIT 20
      `,
      [v.id],
    );
    console.log("verify_photos", ph.rows);
  }
}

await c.end();
console.log("done");
