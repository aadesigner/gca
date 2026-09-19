/**
 * Copy vehicles (and related rows) from production → local Postgres.
 * Only inserts VINs that do not already exist locally — never deletes or overwrites.
 *
 * Skips vehicles that only belong to currently-active "new crawler" providers
 * (default: auctionauto, autopartner, nfsauto) so those can diverge while crawling.
 *
 * Usage (from scripts/):
 *   node --import ./load-env.mjs ./src/sync-prod-vins-to-local.mjs --dry-run --all
 *   node --import ./load-env.mjs ./src/sync-prod-vins-to-local.mjs --apply --all --batch=40
 *   node --import ./load-env.mjs ./src/sync-prod-vins-to-local.mjs --apply --all --skip-providers=auctionauto,autopartner,nfsauto
 *
 * Env: LOCAL_DATABASE_URL / DATABASE_URL, PROD_* or %TEMP%/gca-pg-vars-prod.json
 */
import fs from "node:fs";
import pg from "pg";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const apply = args.has("--apply");
if (!dryRun && !apply) {
  console.error("Pass --dry-run or --apply");
  process.exit(1);
}

const skipArg =
  process.argv.find((a) => a.startsWith("--skip-providers="))?.split("=")[1] ??
  "auctionauto,autopartner,nfsauto";
const skipProviders = skipArg
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.split("=")[1] ?? "all";
const syncAll = args.has("--all") || sinceArg === "all" || sinceArg === "0";
let sinceInterval = null;
if (!syncAll) {
  const sinceMatch = sinceArg.match(/^(\d+)(d|h)$/);
  if (!sinceMatch) {
    console.error("--since must look like 7d, 48h, or all (with --all)");
    process.exit(1);
  }
  sinceInterval = `${sinceMatch[1]} ${sinceMatch[2] === "d" ? "days" : "hours"}`;
}

const batchSize = Number(process.argv.find((a) => a.startsWith("--batch="))?.split("=")[1] ?? "40");
if (!Number.isFinite(batchSize) || batchSize < 1 || batchSize > 200) {
  console.error("--batch must be 1..200");
  process.exit(1);
}

const localUrl = (
  process.env.LOCAL_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip"
).replace(/[?&]sslmode=[^&]+/i, "");
const localConnection = `${localUrl}${localUrl.includes("?") ? "&" : "?"}sslmode=disable`;

function loadProdFromRailwayJson() {
  try {
    const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
    const j = JSON.parse(raw.slice(raw.indexOf("{")));
    const vars = j.variables || j;
    const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
    return {
      host: get("RAILWAY_TCP_PROXY_DOMAIN"),
      port: Number(get("RAILWAY_TCP_PROXY_PORT") || 0),
      user: get("PGUSER") || get("POSTGRES_USER") || "postgres",
      password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
      database: get("PGDATABASE") || "railway",
    };
  } catch {
    return null;
  }
}

const railway = loadProdFromRailwayJson();
const prodConfig = process.env.PROD_DATABASE_URL
  ? null
  : {
      host: process.env.PROD_PG_HOST ?? railway?.host,
      port: Number(process.env.PROD_PG_PORT ?? railway?.port ?? "5432"),
      user: process.env.PROD_PG_USER ?? railway?.user ?? "postgres",
      password: process.env.PROD_PG_PASSWORD ?? railway?.password,
      database: process.env.PROD_PG_DATABASE ?? railway?.database ?? "railway",
      ssl: process.env.PROD_PG_SSL === "1" ? { rejectUnauthorized: false } : false,
    };

if (!process.env.PROD_DATABASE_URL && !prodConfig?.password) {
  console.error("Set PROD_PG_PASSWORD or PROD_DATABASE_URL");
  process.exit(1);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sqlPlaceholders(rows, cols, values) {
  const groups = [];
  let n = 0;
  for (const row of rows) {
    const ph = cols.map((c) => {
      n += 1;
      values.push(row[c]);
      return `$${n}`;
    });
    groups.push(`(${ph.join(",")})`);
  }
  return groups.join(",");
}

async function loadProviderMap(local, prod) {
  const [l, p] = await Promise.all([
    local.query("SELECT id, internal_name FROM providers"),
    prod.query("SELECT id, internal_name FROM providers"),
  ]);
  const localByName = new Map(l.rows.map((r) => [r.internal_name, r.id]));
  /** prod provider id → local provider id */
  const map = new Map();
  const missing = new Set();
  for (const r of p.rows) {
    const localId = localByName.get(r.internal_name);
    if (localId) map.set(r.id, localId);
    else missing.add(r.internal_name);
  }
  if (missing.size) {
    console.warn("Providers missing locally (listings skipped):", [...missing].sort().join(", "));
  }
  return { map, localByName };
}

async function countRelated(prod, vehicleIds) {
  if (!vehicleIds.length) return { listings: 0, observations: 0, events: 0, photos: 0 };
  const { rows } = await prod.query(
    `SELECT
      (SELECT count(*)::int FROM listings WHERE vehicle_id = ANY($1::int[])) AS listings,
      (SELECT count(*)::int FROM vehicle_observations WHERE vehicle_id = ANY($1::int[])) AS observations,
      (SELECT count(*)::int FROM vehicle_events WHERE vehicle_id = ANY($1::int[])) AS events,
      (SELECT count(*)::int FROM photos WHERE vehicle_id = ANY($1::int[])) AS photos`,
    [vehicleIds],
  );
  return rows[0];
}

async function syncBatch({ local, prod, providerMap, vehicles }) {
  const prodVehicleIds = vehicles.map((v) => v.id);
  const stats = { vehicles: 0, listings: 0, observations: 0, events: 0, photos: 0, skippedListings: 0 };

  await local.query("BEGIN");
  try {
    const vCols = [
      "vin",
      "make",
      "model",
      "year",
      "trim",
      "body_type",
      "fuel_type",
      "transmission",
      "drive_type",
      "engine_displacement",
      "color",
      "country",
      "current_known_mileage",
      "last_seen_at",
      "created_at",
      "updated_at",
    ];
    const vValues = [];
    const vPh = sqlPlaceholders(vehicles, vCols, vValues);
    const vRes = await local.query(
      `INSERT INTO vehicles (${vCols.join(",")})
       VALUES ${vPh}
       ON CONFLICT (vin) DO NOTHING
       RETURNING id, vin`,
      vValues,
    );
    stats.vehicles = vRes.rowCount;

    const vehicleIdByVin = new Map(vRes.rows.map((r) => [r.vin, r.id]));
    const missingVins = vehicles.filter((v) => !vehicleIdByVin.has(v.vin)).map((v) => v.vin);
    if (missingVins.length) {
      const exist = await local.query("SELECT id, vin FROM vehicles WHERE vin = ANY($1::text[])", [
        missingVins,
      ]);
      for (const r of exist.rows) vehicleIdByVin.set(r.vin, r.id);
    }

    const vehicleIdMap = new Map();
    for (const v of vehicles) {
      const localId = vehicleIdByVin.get(v.vin);
      if (localId) vehicleIdMap.set(v.id, localId);
    }

    const { rows: listings } = await prod.query(
      `SELECT * FROM listings WHERE vehicle_id = ANY($1::int[]) ORDER BY id`,
      [prodVehicleIds],
    );

    const listingIdMap = new Map();
    const listingRows = [];
    for (const l of listings) {
      const localProviderId = providerMap.get(l.provider_id);
      const localVehicleId = vehicleIdMap.get(l.vehicle_id);
      if (!localProviderId || !localVehicleId) {
        stats.skippedListings += 1;
        continue;
      }
      listingRows.push({
        prodId: l.id,
        provider_id: localProviderId,
        vehicle_id: localVehicleId,
        vin: l.vin,
        source_id: l.source_id,
        source_url: l.source_url,
        title: l.title,
        price_amount: l.price_amount,
        price_currency: l.price_currency,
        price_usd: l.price_usd,
        price_eur: l.price_eur,
        mileage: l.mileage,
        mileage_unit: l.mileage_unit,
        location: l.location,
        country: l.country,
        is_active: l.is_active,
        first_seen_at: l.first_seen_at,
        last_seen_at: l.last_seen_at,
        created_at: l.created_at,
        updated_at: l.updated_at,
      });
    }

    if (listingRows.length) {
      const lCols = [
        "provider_id",
        "vehicle_id",
        "vin",
        "source_id",
        "source_url",
        "title",
        "price_amount",
        "price_currency",
        "price_usd",
        "price_eur",
        "mileage",
        "mileage_unit",
        "location",
        "country",
        "is_active",
        "first_seen_at",
        "last_seen_at",
        "created_at",
        "updated_at",
      ];
      const lValues = [];
      const lPh = sqlPlaceholders(listingRows, lCols, lValues);
      const lRes = await local.query(
        `INSERT INTO listings (${lCols.join(",")})
         VALUES ${lPh}
         ON CONFLICT (provider_id, source_id) DO NOTHING
         RETURNING id, provider_id, source_id`,
        lValues,
      );
      stats.listings = lRes.rowCount;
      const returned = new Map(lRes.rows.map((r) => [`${r.provider_id}:${r.source_id}`, r.id]));
      for (const row of listingRows) {
        const key = `${row.provider_id}:${row.source_id}`;
        let localListingId = returned.get(key);
        if (!localListingId) {
          const hit = await local.query(
            "SELECT id FROM listings WHERE provider_id = $1 AND source_id = $2",
            [row.provider_id, row.source_id],
          );
          localListingId = hit.rows[0]?.id;
        }
        if (localListingId) listingIdMap.set(row.prodId, localListingId);
      }
    }

    const { rows: observations } = await prod.query(
      `SELECT * FROM vehicle_observations WHERE vehicle_id = ANY($1::int[]) ORDER BY id`,
      [prodVehicleIds],
    );
    const obsRows = [];
    for (const o of observations) {
      const localProviderId = providerMap.get(o.provider_id);
      const localVehicleId = vehicleIdMap.get(o.vehicle_id);
      if (!localProviderId || !localVehicleId) continue;
      obsRows.push({
        vehicle_id: localVehicleId,
        provider_id: localProviderId,
        listing_id: o.listing_id ? listingIdMap.get(o.listing_id) ?? null : null,
        source_listing_id: o.source_listing_id,
        fingerprint_hash: o.fingerprint_hash,
        price_amount: o.price_amount,
        price_currency: o.price_currency,
        price_usd: o.price_usd,
        price_eur: o.price_eur,
        mileage: o.mileage,
        mileage_unit: o.mileage_unit,
        listing_status: o.listing_status,
        location: o.location,
        observed_at: o.observed_at,
        source_listed_at: o.source_listed_at,
        source_updated_at: o.source_updated_at,
        created_at: o.created_at,
      });
    }
    const obsWithFp = obsRows.filter((o) => o.fingerprint_hash);
    const obsNoFp = obsRows.filter((o) => !o.fingerprint_hash);
    if (obsWithFp.length) {
      const oCols = [
        "vehicle_id",
        "provider_id",
        "listing_id",
        "source_listing_id",
        "fingerprint_hash",
        "price_amount",
        "price_currency",
        "price_usd",
        "price_eur",
        "mileage",
        "mileage_unit",
        "listing_status",
        "location",
        "observed_at",
        "source_listed_at",
        "source_updated_at",
        "created_at",
      ];
      const oValues = [];
      const oPh = sqlPlaceholders(obsWithFp, oCols, oValues);
      const oRes = await local.query(
        `INSERT INTO vehicle_observations (${oCols.join(",")})
         VALUES ${oPh}
         ON CONFLICT (fingerprint_hash) WHERE fingerprint_hash IS NOT NULL DO NOTHING`,
        oValues,
      );
      stats.observations += oRes.rowCount;
    }
    if (obsNoFp.length) {
      const oCols = [
        "vehicle_id",
        "provider_id",
        "listing_id",
        "source_listing_id",
        "fingerprint_hash",
        "price_amount",
        "price_currency",
        "price_usd",
        "price_eur",
        "mileage",
        "mileage_unit",
        "listing_status",
        "location",
        "observed_at",
        "source_listed_at",
        "source_updated_at",
        "created_at",
      ];
      const oValues = [];
      const oPh = sqlPlaceholders(obsNoFp, oCols, oValues);
      const oRes = await local.query(
        `INSERT INTO vehicle_observations (${oCols.join(",")}) VALUES ${oPh}`,
        oValues,
      );
      stats.observations += oRes.rowCount;
    }

    const { rows: events } = await prod.query(
      `SELECT * FROM vehicle_events WHERE vehicle_id = ANY($1::int[]) ORDER BY id`,
      [prodVehicleIds],
    );
    const evRows = [];
    for (const e of events) {
      const localVehicleId = vehicleIdMap.get(e.vehicle_id);
      if (!localVehicleId) continue;
      evRows.push({
        vehicle_id: localVehicleId,
        event_type: e.event_type,
        description: e.description,
        metadata: e.metadata,
        occurred_at: e.occurred_at,
        created_at: e.created_at,
      });
    }
    if (evRows.length) {
      const eCols = ["vehicle_id", "event_type", "description", "metadata", "occurred_at", "created_at"];
      // Insert in smaller chunks — unique constraint can conflict heavily
      for (const part of chunk(evRows, 200)) {
        const eValues = [];
        const ePh = sqlPlaceholders(part, eCols, eValues);
        try {
          const eRes = await local.query(
            `INSERT INTO vehicle_events (${eCols.join(",")})
             VALUES ${ePh}
             ON CONFLICT (vehicle_id, event_type, (date((occurred_at AT TIME ZONE 'UTC'))), (md5(COALESCE(description, ''))))
             DO NOTHING`,
            eValues,
          );
          stats.events += eRes.rowCount;
        } catch (err) {
          // Fallback row-by-row if batch conflict expression fails on older schema
          if (!/ON CONFLICT|unique/i.test(String(err.message))) throw err;
          for (const row of part) {
            try {
              const vals = [];
              const ph = sqlPlaceholders([row], eCols, vals);
              const r = await local.query(
                `INSERT INTO vehicle_events (${eCols.join(",")}) VALUES ${ph}
                 ON CONFLICT DO NOTHING`,
                vals,
              );
              stats.events += r.rowCount;
            } catch {
              /* skip bad event */
            }
          }
        }
      }
    }

    const isCdnPath = (u) => !!u && /imgsv\.getcarapi\.com|\.r2\.dev\//i.test(String(u));
    const { rows: photos } = await prod.query(
      `SELECT * FROM photos WHERE vehicle_id = ANY($1::int[]) ORDER BY id`,
      [prodVehicleIds],
    );
    const pRows = [];
    for (const p of photos) {
      const localVehicleId = p.vehicle_id ? vehicleIdMap.get(p.vehicle_id) : null;
      const localListingId = p.listing_id ? listingIdMap.get(p.listing_id) : null;
      if (!localVehicleId && !localListingId) continue;
      pRows.push({
        vehicle_id: localVehicleId,
        listing_id: localListingId,
        source_url: p.source_url,
        stored_path: isCdnPath(p.stored_path) ? p.stored_path : null,
        width: p.width,
        height: p.height,
        is_primary: p.is_primary,
        sort_order: p.sort_order,
        photo_group: p.photo_group,
        created_at: p.created_at,
      });
    }
    const pWithListing = pRows.filter((p) => p.listing_id);
    const pVehicleOnly = pRows.filter((p) => !p.listing_id && p.vehicle_id);
    if (pWithListing.length) {
      for (const part of chunk(pWithListing, 200)) {
        const pCols = [
          "vehicle_id",
          "listing_id",
          "source_url",
          "stored_path",
          "width",
          "height",
          "is_primary",
          "sort_order",
          "photo_group",
          "created_at",
        ];
        const pValues = [];
        const pPh = sqlPlaceholders(part, pCols, pValues);
        const pRes = await local.query(
          `INSERT INTO photos (${pCols.join(",")})
           VALUES ${pPh}
           ON CONFLICT (listing_id, source_url) DO NOTHING`,
          pValues,
        );
        stats.photos += pRes.rowCount;
      }
    }
    if (pVehicleOnly.length) {
      for (const part of chunk(pVehicleOnly, 200)) {
        const pCols = [
          "vehicle_id",
          "listing_id",
          "source_url",
          "stored_path",
          "width",
          "height",
          "is_primary",
          "sort_order",
          "photo_group",
          "created_at",
        ];
        const pValues = [];
        const pPh = sqlPlaceholders(part, pCols, pValues);
        const pRes = await local.query(
          `INSERT INTO photos (${pCols.join(",")})
           VALUES ${pPh}
           ON CONFLICT (vehicle_id, source_url) WHERE vehicle_id IS NOT NULL DO NOTHING`,
          pValues,
        );
        stats.photos += pRes.rowCount;
      }
    }

    await local.query("COMMIT");
    return stats;
  } catch (err) {
    await local.query("ROLLBACK");
    throw err;
  }
}

async function main() {
  console.log(`Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);
  console.log(
    `Direction: production → local | scope: ${syncAll ? "ALL" : `since ${sinceInterval}`} | batch: ${batchSize}`,
  );
  console.log(`Skip vehicles only-from providers: ${skipProviders.join(", ") || "(none)"}`);

  const local = new pg.Client({ connectionString: localConnection });
  const prod = process.env.PROD_DATABASE_URL
    ? new pg.Client({
        connectionString: process.env.PROD_DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      })
    : new pg.Client(prodConfig);
  await local.connect();
  await prod.connect();

  const { map: providerMap } = await loadProviderMap(local, prod);

  console.log("Loading local VIN set…");
  const { rows: localVins } = await local.query("SELECT vin FROM vehicles");
  const localVinSet = new Set(localVins.map((r) => r.vin));
  console.log(`Local vehicles: ${localVinSet.size}`);

  const { rows: prodCount } = await prod.query("SELECT count(*)::int AS c FROM vehicles");
  console.log(`Production vehicles: ${prodCount[0].c}`);

  // Candidates: prod vehicles that have at least one listing outside active crawlers,
  // or have no listings at all.
  const skipParams = skipProviders.length ? skipProviders : ["__none__"];
  let candidates;
  if (syncAll) {
    console.log("Selecting prod candidate vehicles (excluding active-crawler-only)…");
    const { rows } = await prod.query(
      `
      SELECT v.*
      FROM vehicles v
      WHERE (
        NOT EXISTS (SELECT 1 FROM listings l WHERE l.vehicle_id = v.id)
        OR EXISTS (
          SELECT 1
          FROM listings l
          JOIN providers p ON p.id = l.provider_id
          WHERE l.vehicle_id = v.id
            AND NOT (p.internal_name = ANY($1::text[]))
        )
      )
      ORDER BY v.id
      `,
      [skipParams],
    );
    candidates = rows;
  } else {
    const { rows } = await prod.query(
      `
      SELECT v.*
      FROM vehicles v
      WHERE v.created_at > now() - $2::interval
        AND (
          NOT EXISTS (SELECT 1 FROM listings l WHERE l.vehicle_id = v.id)
          OR EXISTS (
            SELECT 1
            FROM listings l
            JOIN providers p ON p.id = l.provider_id
            WHERE l.vehicle_id = v.id
              AND NOT (p.internal_name = ANY($1::text[]))
          )
        )
      ORDER BY v.id
      `,
      [skipParams, sinceInterval],
    );
    candidates = rows;
  }

  const missing = candidates.filter((v) => !localVinSet.has(v.vin));
  console.log(
    `Prod candidates: ${candidates.length}, missing locally: ${missing.length}`,
  );

  // How many prod-only are active-crawler-only (for reporting)
  const { rows: activeOnly } = await prod.query(
    `
    SELECT count(*)::int AS c
    FROM vehicles v
    WHERE EXISTS (SELECT 1 FROM listings l WHERE l.vehicle_id = v.id)
      AND NOT EXISTS (
        SELECT 1 FROM listings l
        JOIN providers p ON p.id = l.provider_id
        WHERE l.vehicle_id = v.id
          AND NOT (p.internal_name = ANY($1::text[]))
      )
    `,
    [skipParams],
  );
  console.log(`Prod vehicles only-from active crawlers (skipped by design): ${activeOnly[0].c}`);

  if (!missing.length) {
    console.log("Nothing to sync.");
    await local.end();
    await prod.end();
    return;
  }

  const sampleIds = missing.slice(0, Math.min(100, missing.length)).map((v) => v.id);
  const rel = await countRelated(prod, sampleIds);
  const scale = missing.length / sampleIds.length;
  console.log("Estimated rows to copy (from sample):", {
    listings: Math.round(rel.listings * scale),
    observations: Math.round(rel.observations * scale),
    events: Math.round(rel.events * scale),
    photos: Math.round(rel.photos * scale),
  });

  if (dryRun) {
    console.log("Dry run complete — no changes made.");
    await local.end();
    await prod.end();
    return;
  }

  const batches = chunk(missing, batchSize);
  const totals = { vehicles: 0, listings: 0, observations: 0, events: 0, photos: 0, skippedListings: 0 };
  const started = Date.now();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const stats = await syncBatch({ local, prod, providerMap, vehicles: batch });
    for (const k of Object.keys(totals)) totals[k] += stats[k] ?? 0;
    if ((i + 1) % 25 === 0 || i + 1 === batches.length) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(0);
      console.log(
        `Batch ${i + 1}/${batches.length} (${elapsed}s) — inserted vehicles=${totals.vehicles} listings=${totals.listings} obs=${totals.observations} events=${totals.events} photos=${totals.photos} skippedListings=${totals.skippedListings}`,
      );
    }
  }

  const { rows: finalLocal } = await local.query("SELECT count(*)::int AS c FROM vehicles");
  const { rows: finalProd } = await prod.query("SELECT count(*)::int AS c FROM vehicles");
  console.log("Done. Local vehicles now:", finalLocal[0].c, "| Prod:", finalProd[0].c);
  console.log("Totals inserted:", totals);

  await local.end();
  await prod.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
