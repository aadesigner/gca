/**
 * Purge Autowini listings + photos (+ Autowini-only vehicles) so a fresh crawl
 * can repopulate with mirrorable galleries.
 *
 *   TARGET=prod|local DRY=1 node --import ./load-env.mjs ./src/_ops-purge-autowini.mjs
 *   TARGET=prod node --import ./load-env.mjs ./src/_ops-purge-autowini.mjs
 *   TARGET=local node --import ./load-env.mjs ./src/_ops-purge-autowini.mjs
 *   TARGET=both node --import ./load-env.mjs ./src/_ops-purge-autowini.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const DRY = process.env.DRY === "1";
const TARGET = (process.env.TARGET || "both").toLowerCase();

function loadProd() {
  const p = path.join(os.tmpdir(), "gca-pg-vars-prod.json");
  const raw = fs.readFileSync(p, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) =>
    vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n];
  return {
    host: get("RAILWAY_TCP_PROXY_DOMAIN"),
    port: Number(get("RAILWAY_TCP_PROXY_PORT") || 5432),
    user: get("PGUSER") || get("POSTGRES_USER") || "postgres",
    password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
    database: get("PGDATABASE") || "railway",
    ssl: false,
  };
}

async function purgeAutowini(c, label) {
  const { rows: prov } = await c.query(
    `SELECT id FROM providers WHERE internal_name = 'autowini' LIMIT 1`,
  );
  const pid = prov[0]?.id;
  if (!pid) {
    console.log(label, "skip — no autowini provider");
    return;
  }

  const before = await c.query(
    `
    SELECT
      (SELECT count(*)::bigint FROM listings WHERE provider_id = $1) AS listings,
      (SELECT count(*)::bigint FROM photos
         WHERE source_url ILIKE '%autowini%'
            OR listing_id IN (SELECT id FROM listings WHERE provider_id = $1)) AS photos,
      (SELECT count(DISTINCT vehicle_id)::bigint FROM listings WHERE provider_id = $1) AS vehicles
    `,
    [pid],
  );
  console.log(label, "before", before.rows[0]);

  if (DRY) {
    console.log(label, "[dry-run] no deletes");
    return;
  }

  await c.query("BEGIN");
  try {
    // Pause Autowini crawl jobs while we wipe.
    await c.query(
      `
      UPDATE collection_jobs
      SET status = 'paused',
          error_message = 'paused — Autowini purge / re-crawl',
          updated_at = now()
      WHERE provider_id = $1
        AND status IN ('running', 'pending')
      `,
      [pid],
    );

    // Photos on Autowini listings
    const phList = await c.query(
      `
      DELETE FROM photos
      WHERE listing_id IN (SELECT id FROM listings WHERE provider_id = $1)
      `,
      [pid],
    );

    // Orphan Autowini URL photos (listing remapped / null listing)
    const phUrl = await c.query(
      `
      DELETE FROM photos
      WHERE source_url ILIKE '%autowini%'
         OR source_url ILIKE '%imagebox.autowini.com%'
         OR source_url ILIKE '%image.autowini.com%'
      `,
    );

    // Raw crawl blobs for Autowini listings
    const raw = await c.query(
      `
      DELETE FROM raw_source_records
      WHERE listing_id IN (SELECT id FROM listings WHERE provider_id = $1)
         OR (provider_id = $1)
      `,
      [pid],
    );

    // Observations tied to Autowini listings
    const obs = await c.query(
      `
      DELETE FROM vehicle_observations
      WHERE listing_id IN (SELECT id FROM listings WHERE provider_id = $1)
      `,
      [pid],
    );

    // Vehicles that ONLY have Autowini listings (capture before listing delete)
    const solo = await c.query(
      `
      SELECT DISTINCT l.vehicle_id AS id
      FROM listings l
      WHERE l.provider_id = $1
        AND l.vehicle_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM listings o
          WHERE o.vehicle_id = l.vehicle_id
            AND o.provider_id <> $1
        )
      `,
      [pid],
    );
    const soloIds = solo.rows.map((r) => Number(r.id)).filter((id) => id > 0);

    // All Autowini listings (solo + multi-provider cars)
    const listings = await c.query(`DELETE FROM listings WHERE provider_id = $1`, [pid]);

    let vehDel = 0;
    let evDel = 0;
    let ovDel = 0;
    if (soloIds.length) {
      const chunk = 2000;
      for (let i = 0; i < soloIds.length; i += chunk) {
        const batch = soloIds.slice(i, i + chunk);
        const e = await c.query(`DELETE FROM vehicle_events WHERE vehicle_id = ANY($1::int[])`, [
          batch,
        ]);
        evDel += e.rowCount ?? 0;
        const o = await c.query(
          `DELETE FROM normalization_overrides WHERE vehicle_id = ANY($1::int[])`,
          [batch],
        );
        ovDel += o.rowCount ?? 0;
        await c.query(`DELETE FROM photos WHERE vehicle_id = ANY($1::int[])`, [batch]);
        await c.query(`DELETE FROM vehicle_observations WHERE vehicle_id = ANY($1::int[])`, [
          batch,
        ]);
        const v = await c.query(`DELETE FROM vehicles WHERE id = ANY($1::int[])`, [batch]);
        vehDel += v.rowCount ?? 0;
      }
    }

    await c.query("COMMIT");

    const after = await c.query(
      `
      SELECT
        (SELECT count(*)::bigint FROM listings WHERE provider_id = $1) AS listings,
        (SELECT count(*)::bigint FROM photos
           WHERE source_url ILIKE '%autowini%'
              OR listing_id IN (SELECT id FROM listings WHERE provider_id = $1)) AS photos
      `,
      [pid],
    );

    console.log(label, "deleted", {
      photosViaListing: phList.rowCount,
      photosByUrl: phUrl.rowCount,
      raw: raw.rowCount,
      observations: obs.rowCount,
      soloVehicles: soloIds.length,
      vehiclesRemoved: vehDel,
      eventsRemoved: evDel,
      overridesRemoved: ovDel,
      listings: listings.rowCount,
    });
    console.log(label, "after", after.rows[0]);
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  }
}

const targets = [];
if (TARGET === "both" || TARGET === "prod") targets.push(["PROD", () => new pg.Client(loadProd())]);
if (TARGET === "both" || TARGET === "local") {
  if (!process.env.DATABASE_URL) {
    console.warn("LOCAL skipped — DATABASE_URL not set");
  } else {
    targets.push([
      "LOCAL",
      () => new pg.Client({ connectionString: process.env.DATABASE_URL }),
    ]);
  }
}

for (const [label, factory] of targets) {
  const c = factory();
  await c.connect();
  try {
    await purgeAutowini(c, label);
  } finally {
    await c.end();
  }
}

console.log(DRY ? "\nDry-run only. Re-run without DRY=1 to apply." : "\nDone. Re-enable Autowini crawl when ready.");
