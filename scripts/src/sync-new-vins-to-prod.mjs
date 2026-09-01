/**
 * Incrementally copy vehicles (and related rows) from local Postgres to production.
 * Only inserts VINs that do not already exist in production — never deletes or overwrites.
 *
 * Usage:
 *   node --import ./load-env.mjs ./src/sync-new-vins-to-prod.mjs --dry-run
 *   node --import ./load-env.mjs ./src/sync-new-vins-to-prod.mjs --apply --since 7d
 *
 * Env:
 *   LOCAL_DATABASE_URL  (default postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip)
 *   PROD_PG_HOST, PROD_PG_PORT, PROD_PG_USER, PROD_PG_PASSWORD, PROD_PG_DATABASE
 */

import pg from "pg";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const apply = args.has("--apply");
if (!dryRun && !apply) {
  console.error("Pass --dry-run or --apply");
  process.exit(1);
}

const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.split("=")[1] ?? "7d";
const sinceMatch = sinceArg.match(/^(\d+)(d|h)$/);
if (!sinceMatch) {
  console.error("--since must look like 7d or 48h");
  process.exit(1);
}
const sinceInterval = `${sinceMatch[1]} ${sinceMatch[2] === "d" ? "days" : "hours"}`;

const batchSize = Number(process.argv.find((a) => a.startsWith("--batch="))?.split("=")[1] ?? "50");
if (!Number.isFinite(batchSize) || batchSize < 1 || batchSize > 500) {
  console.error("--batch must be 1..500");
  process.exit(1);
}

const localUrl =
  process.env.LOCAL_DATABASE_URL ?? "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip";

const prodConfig = {
  host: process.env.PROD_PG_HOST ?? "tokaido.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT ?? "11425"),
  user: process.env.PROD_PG_USER ?? "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE ?? "railway",
  // Railway TCP proxy speaks plain Postgres; SSL negotiation is flaky on the proxy path.
  ssl: process.env.PROD_PG_SSL === "1" ? { rejectUnauthorized: false } : false,
};

if (!prodConfig.password) {
  console.error("Set PROD_PG_PASSWORD (Railway Postgres password)");
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
  const prodByName = new Map(p.rows.map((r) => [r.internal_name, r.id]));
  const map = new Map();
  const missing = new Set();
  for (const r of l.rows) {
    const prodId = prodByName.get(r.internal_name);
    if (prodId) map.set(r.id, prodId);
    else missing.add(r.internal_name);
  }
  if (missing.size) {
    console.warn("Providers missing in prod (listings skipped):", [...missing].sort().join(", "));
  }
  return map;
}

async function countRelated(local, vehicleIds) {
  if (!vehicleIds.length) {
    return { listings: 0, observations: 0, events: 0, photos: 0 };
  }
  const { rows } = await local.query(
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
  const localVehicleIds = vehicles.map((v) => v.id);
  const stats = { vehicles: 0, listings: 0, observations: 0, events: 0, photos: 0, skippedListings: 0 };

  const client = prod;
  await client.query("BEGIN");

  try {
    // --- vehicles ---
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
    const vRes = await client.query(
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
      const exist = await client.query("SELECT id, vin FROM vehicles WHERE vin = ANY($1::text[])", [
        missingVins,
      ]);
      for (const r of exist.rows) vehicleIdByVin.set(r.vin, r.id);
    }

    const vehicleIdMap = new Map();
    for (const v of vehicles) {
      const prodId = vehicleIdByVin.get(v.vin);
      if (prodId) vehicleIdMap.set(v.id, prodId);
    }

    // --- listings ---
    const { rows: listings } = await local.query(
      `SELECT * FROM listings WHERE vehicle_id = ANY($1::int[]) ORDER BY id`,
      [localVehicleIds],
    );

    const listingIdMap = new Map();
    const listingRows = [];
    for (const l of listings) {
      const prodProviderId = providerMap.get(l.provider_id);
      const prodVehicleId = vehicleIdMap.get(l.vehicle_id);
      if (!prodProviderId || !prodVehicleId) {
        stats.skippedListings += 1;
        continue;
      }
      listingRows.push({
        localId: l.id,
        provider_id: prodProviderId,
        vehicle_id: prodVehicleId,
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
      const lRes = await client.query(
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
        let prodListingId = returned.get(key);
        if (!prodListingId) {
          const hit = await client.query(
            "SELECT id FROM listings WHERE provider_id = $1 AND source_id = $2",
            [row.provider_id, row.source_id],
          );
          prodListingId = hit.rows[0]?.id;
        }
        if (prodListingId) listingIdMap.set(row.localId, prodListingId);
      }
    }

    // --- observations ---
    const { rows: observations } = await local.query(
      `SELECT * FROM vehicle_observations WHERE vehicle_id = ANY($1::int[]) ORDER BY id`,
      [localVehicleIds],
    );
    const obsRows = [];
    for (const o of observations) {
      const prodProviderId = providerMap.get(o.provider_id);
      const prodVehicleId = vehicleIdMap.get(o.vehicle_id);
      if (!prodProviderId || !prodVehicleId) continue;
      obsRows.push({
        vehicle_id: prodVehicleId,
        provider_id: prodProviderId,
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
      const oRes = await client.query(
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
      const oRes = await client.query(
        `INSERT INTO vehicle_observations (${oCols.join(",")}) VALUES ${oPh}`,
        oValues,
      );
      stats.observations += oRes.rowCount;
    }

    // --- events ---
    const { rows: events } = await local.query(
      `SELECT * FROM vehicle_events WHERE vehicle_id = ANY($1::int[]) ORDER BY id`,
      [localVehicleIds],
    );
    const evRows = [];
    for (const e of events) {
      const prodVehicleId = vehicleIdMap.get(e.vehicle_id);
      if (!prodVehicleId) continue;
      evRows.push({
        vehicle_id: prodVehicleId,
        event_type: e.event_type,
        description: e.description,
        metadata: e.metadata,
        occurred_at: e.occurred_at,
        created_at: e.created_at,
      });
    }
    if (evRows.length) {
      const eCols = ["vehicle_id", "event_type", "description", "metadata", "occurred_at", "created_at"];
      const eValues = [];
      const ePh = sqlPlaceholders(evRows, eCols, eValues);
      const eRes = await client.query(
        `INSERT INTO vehicle_events (${eCols.join(",")})
         VALUES ${ePh}
         ON CONFLICT (vehicle_id, event_type, (date((occurred_at AT TIME ZONE 'UTC'))), (md5(COALESCE(description, ''))))
         DO NOTHING`,
        eValues,
      );
      stats.events = eRes.rowCount;
    }

    // --- photos ---
    const { rows: photos } = await local.query(
      `SELECT * FROM photos WHERE vehicle_id = ANY($1::int[]) ORDER BY id`,
      [localVehicleIds],
    );
    const pRows = [];
    for (const p of photos) {
      const prodVehicleId = p.vehicle_id ? vehicleIdMap.get(p.vehicle_id) : null;
      const prodListingId = p.listing_id ? listingIdMap.get(p.listing_id) : null;
      if (!prodVehicleId && !prodListingId) continue;
      pRows.push({
        vehicle_id: prodVehicleId,
        listing_id: prodListingId,
        source_url: p.source_url,
        stored_path: p.stored_path,
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
      const pPh = sqlPlaceholders(pWithListing, pCols, pValues);
      const pRes = await client.query(
        `INSERT INTO photos (${pCols.join(",")})
         VALUES ${pPh}
         ON CONFLICT (listing_id, source_url) DO NOTHING`,
        pValues,
      );
      stats.photos += pRes.rowCount;
    }
    if (pVehicleOnly.length) {
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
      const pPh = sqlPlaceholders(pVehicleOnly, pCols, pValues);
      const pRes = await client.query(
        `INSERT INTO photos (${pCols.join(",")})
         VALUES ${pPh}
         ON CONFLICT (vehicle_id, source_url) WHERE vehicle_id IS NOT NULL DO NOTHING`,
        pValues,
      );
      stats.photos += pRes.rowCount;
    }

    await client.query("COMMIT");
    return stats;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function main() {
  console.log(`Mode: ${dryRun ? "DRY RUN" : "APPLY"}`);
  console.log(`Since: ${sinceInterval}, batch: ${batchSize}`);

  const local = new pg.Client({ connectionString: localUrl });
  const prod = new pg.Client({
    ...prodConfig,
    ssl: false,
  });
  await local.connect();
  await prod.connect();

  const providerMap = await loadProviderMap(local, prod);

  const { rows: prodVins } = await prod.query("SELECT vin FROM vehicles");
  const prodVinSet = new Set(prodVins.map((r) => r.vin));
  console.log(`Production vehicles: ${prodVinSet.size}`);

  const { rows: candidates } = await local.query(
    `SELECT * FROM vehicles
     WHERE created_at > now() - $1::interval
     ORDER BY id`,
    [sinceInterval],
  );
  const missing = candidates.filter((v) => !prodVinSet.has(v.vin));
  console.log(`Local since ${sinceArg}: ${candidates.length}, missing in prod: ${missing.length}`);

  if (!missing.length) {
    console.log("Nothing to sync.");
    await local.end();
    await prod.end();
    return;
  }

  const sampleIds = missing.slice(0, Math.min(200, missing.length)).map((v) => v.id);
  const rel = await countRelated(local, sampleIds);
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
    if ((i + 1) % 10 === 0 || i + 1 === batches.length) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(0);
      console.log(
        `Batch ${i + 1}/${batches.length} (${elapsed}s) — inserted vehicles=${totals.vehicles} listings=${totals.listings} obs=${totals.observations} events=${totals.events} photos=${totals.photos}`,
      );
    }
  }

  const { rows: finalCount } = await prod.query("SELECT count(*)::int AS c FROM vehicles");
  console.log("Done. Production vehicles now:", finalCount[0].c);
  console.log("Totals inserted:", totals);

  await local.end();
  await prod.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
