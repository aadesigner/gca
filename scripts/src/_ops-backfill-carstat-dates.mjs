/**
 * Backfill Carstat mileage/observation dates from catalog endTime/createdAt
 * (Trading ended / auction schedule) instead of crawl timestamps.
 *
 * Walks carstat.info/catalog pages via CDP, maps lot UUID → dates, then UPDATEs
 * vehicle_observations + listings. Safe to re-run (only fills/upgrades dates).
 *
 *   APPLY=1 node --import ./load-env.mjs ./src/_ops-backfill-carstat-dates.mjs
 *   MAX_PAGES=200 APPLY=1 node --import ./load-env.mjs ./src/_ops-backfill-carstat-dates.mjs
 *   TARGET=prod APPLY=1 node --import ./load-env.mjs ./src/_ops-backfill-carstat-dates.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import {
  extractCarstatCatalogLots,
  parseCarstatDate,
} from "../../artifacts/api-server/src/lib/providers/carstat.ts";
import { carstatGetViaCdp } from "../../artifacts/api-server/src/lib/providers/carstat-cdp.ts";

const APPLY = process.env.APPLY === "1";
const TARGET = (process.env.TARGET || "local").toLowerCase();
const MAX_PAGES = Number(process.env.MAX_PAGES || 0) || 0; // 0 = until empty/EOF
const DELAY_MS = Number(process.env.DELAY_MS || 200) || 200;
/** Stop early once this fraction of DB lots needing dates are mapped (0 = disabled). */
const COVERAGE_STOP = Number(process.env.COVERAGE_STOP || 0.98) || 0.98;


function loadProd() {
  if (process.env.PROD_DATABASE_URL) {
    return { connectionString: process.env.PROD_DATABASE_URL, ssl: { rejectUnauthorized: false } };
  }
  const p = path.join(os.tmpdir(), "gca-pg-vars-prod.json");
  const raw = fs.readFileSync(p, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) =>
    vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n];
  return {
    host: get("RAILWAY_TCP_PROXY_DOMAIN") || process.env.PROD_PG_HOST,
    port: Number(get("RAILWAY_TCP_PROXY_PORT") || process.env.PROD_PG_PORT || 5432),
    user: get("PGUSER") || get("POSTGRES_USER") || process.env.PROD_PG_USER || "postgres",
    password: get("PGPASSWORD") || get("POSTGRES_PASSWORD") || process.env.PROD_PG_PASSWORD,
    database: get("PGDATABASE") || process.env.PROD_PG_DATABASE || "railway",
    ssl: false,
  };
}

function localClient() {
  const url =
    process.env.LOCAL_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip";
  return new pg.Client({
    connectionString: url.includes("sslmode=") ? url : `${url}${url.includes("?") ? "&" : "?"}sslmode=disable`,
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function catalogUrl(page) {
  if (page <= 1) return "https://carstat.info/catalog";
  return `https://carstat.info/catalog/page/${page}`;
}

/** @type {Map<string, { endAt: Date|null, listedAt: Date|null }>} */
const datesByLot = new Map();
/** @type {Set<string>} */
let neededIds = new Set();

const CHECKPOINT = path.join(
  os.tmpdir(),
  `gca-carstat-dates-${TARGET}.json`,
);

function saveCheckpoint(page) {
  const payload = {
    page,
    savedAt: new Date().toISOString(),
    entries: [...datesByLot.entries()].map(([id, d]) => [
      id,
      d.listedAt?.toISOString() ?? null,
      d.endAt?.toISOString() ?? null,
    ]),
  };
  fs.writeFileSync(CHECKPOINT, JSON.stringify(payload));
  console.log(`checkpoint → ${CHECKPOINT} page=${page} lots=${datesByLot.size}`);
}

function loadCheckpoint() {
  if (process.env.FRESH === "1") return 1;
  if (!fs.existsSync(CHECKPOINT)) return 1;
  try {
    const j = JSON.parse(fs.readFileSync(CHECKPOINT, "utf8"));
    for (const [id, listed, end] of j.entries || []) {
      datesByLot.set(String(id).toLowerCase(), {
        listedAt: listed ? new Date(listed) : null,
        endAt: end ? new Date(end) : null,
      });
    }
    const start = Number(j.page || 1) + 1;
    console.log(`resumed checkpoint page=${j.page} lots=${datesByLot.size} → start ${start}`);
    return Math.max(1, start);
  } catch (e) {
    console.warn("checkpoint load failed:", e.message || e);
    return 1;
  }
}

async function loadNeededIds(client) {
  const r = await client.query(`
    SELECT o.source_listing_id AS id
    FROM vehicle_observations o
    JOIN providers p ON p.id = o.provider_id
    WHERE p.internal_name = 'carstat'
      AND o.source_listing_id IS NOT NULL
      AND (
        o.source_listed_at IS NULL
        OR o.source_updated_at IS NULL
        OR o.observed_at::date >= '2026-09-16'
      )
  `);
  neededIds = new Set(r.rows.map((x) => String(x.id).toLowerCase()));
  console.log(`lots needing dates: ${neededIds.size}`);
}

function coverage() {
  if (neededIds.size === 0) return 1;
  let hit = 0;
  for (const id of neededIds) if (datesByLot.has(id)) hit += 1;
  return hit / neededIds.size;
}

async function walkCatalog(startPage = 1) {
  let page = startPage;
  let emptyStreak = 0;
  let siteMax = 0;
  while (true) {
    if (MAX_PAGES > 0 && page > MAX_PAGES) break;
    const url = catalogUrl(page);
    let html = "";
    try {
      const r = await carstatGetViaCdp(url);
      html = r.text || "";
      if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      console.error(`page ${page} fetch failed:`, e.message || e);
      emptyStreak += 1;
      if (emptyStreak >= 12) {
        console.log(`fetch failures streak ${emptyStreak} at page ${page} — stopping`);
        break;
      }
      await sleep(DELAY_MS * 3);
      page += 1;
      continue;
    }
    const lots = extractCarstatCatalogLots(html);
    let added = 0;
    for (const lot of lots) {
      const endAt = parseCarstatDate(lot.endTime) ?? null;
      const listedAt = parseCarstatDate(lot.createdAt) ?? null;
      if (!endAt && !listedAt) continue;
      const id = lot.id.toLowerCase();
      if (!datesByLot.has(id)) added += 1;
      datesByLot.set(id, { endAt, listedAt });
    }
    const pager = html.match(/\/catalog\/page\/(\d+)/g) || [];
    for (const p of pager) {
      const n = Number(p.match(/(\d+)$/)?.[1] || 0);
      if (n > siteMax) siteMax = n;
    }
    const cov = coverage();
    if (page % 25 === 0 || page <= 3) {
      console.log(
        JSON.stringify({
          page,
          lots: lots.length,
          added,
          mapSize: datesByLot.size,
          coverage: Number(cov.toFixed(4)),
          needed: neededIds.size,
          siteMax,
        }),
      );
    }
    if (neededIds.size > 0 && cov >= COVERAGE_STOP && page > 50) {
      console.log(`coverage ${cov.toFixed(3)} >= ${COVERAGE_STOP} — stopping catalog walk`);
      break;
    }
    if (lots.length === 0) {
      emptyStreak += 1;
      // Deep pager windows sometimes return empty HTML — don't abort the whole walk.
      if (emptyStreak >= 12 && page > 200) {
        console.log(`empty streak ${emptyStreak} at page ${page} — stopping`);
        break;
      }
    } else {
      emptyStreak = 0;
    }
    if (siteMax > 0 && page >= siteMax) break;
    // Checkpoint every 50 pages so APPLY can resume after a crash.
    if (page % 50 === 0) saveCheckpoint(page);
    page += 1;
    await sleep(DELAY_MS);
  }
  saveCheckpoint(page);
}

async function applyDates(client) {
  await client.query(`
    CREATE TEMP TABLE _carstat_dates (
      source_id text PRIMARY KEY,
      listed_at timestamptz,
      end_at timestamptz
    ) ON COMMIT DROP
  `);

  const rows = [...datesByLot.entries()].map(([id, d]) => [
    id.toLowerCase(),
    d.listedAt?.toISOString() ?? null,
    d.endAt?.toISOString() ?? null,
  ]);
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    let n = 1;
    for (const [id, listed, end] of chunk) {
      values.push(`($${n++}, $${n++}::timestamptz, $${n++}::timestamptz)`);
      params.push(id, listed, end);
    }
    await client.query(
      `INSERT INTO _carstat_dates (source_id, listed_at, end_at) VALUES ${values.join(",")}
       ON CONFLICT (source_id) DO UPDATE SET
         listed_at = COALESCE(EXCLUDED.listed_at, _carstat_dates.listed_at),
         end_at = COALESCE(EXCLUDED.end_at, _carstat_dates.end_at)`,
      params,
    );
  }

  const prov = await client.query(`SELECT id FROM providers WHERE internal_name = 'carstat'`);
  const providerId = prov.rows[0]?.id;
  if (!providerId) throw new Error("carstat provider missing");

  const obs = await client.query(
    `
    UPDATE vehicle_observations o
    SET
      source_listed_at = COALESCE(d.listed_at, d.end_at, o.source_listed_at),
      source_updated_at = COALESCE(d.end_at, d.listed_at, o.source_updated_at),
      observed_at = CASE
        -- Prefer auction end (or publish) over crawl-time when site date is >1 day earlier
        WHEN COALESCE(d.end_at, d.listed_at) IS NOT NULL
          AND COALESCE(d.end_at, d.listed_at) < o.observed_at - interval '1 day'
          THEN COALESCE(d.end_at, d.listed_at)
        ELSE o.observed_at
      END
    FROM _carstat_dates d
    WHERE o.provider_id = $1
      AND lower(o.source_listing_id) = d.source_id
      AND (
        o.source_listed_at IS NULL
        OR o.source_updated_at IS NULL
        OR o.observed_at > COALESCE(d.end_at, d.listed_at) + interval '1 day'
      )
    `,
    [providerId],
  );

  const listings = await client.query(
    `
    UPDATE listings l
    SET
      first_seen_at = LEAST(l.first_seen_at, COALESCE(d.listed_at, d.end_at, l.first_seen_at)),
      last_seen_at = COALESCE(d.end_at, d.listed_at, l.last_seen_at),
      updated_at = now()
    FROM _carstat_dates d
    WHERE l.provider_id = $1
      AND lower(l.source_id) = d.source_id
      AND (
        l.first_seen_at > COALESCE(d.listed_at, d.end_at, l.first_seen_at)
        OR l.last_seen_at IS DISTINCT FROM COALESCE(d.end_at, d.listed_at, l.last_seen_at)
      )
    `,
    [providerId],
  );

  // Events that were stamped at crawl time (linked via vehicle + carstat listing).
  let eventsUpdated = 0;
  try {
    const events = await client.query(
      `
      UPDATE vehicle_events e
      SET occurred_at = COALESCE(d.end_at, d.listed_at)
      FROM listings l
      JOIN _carstat_dates d ON d.source_id = lower(l.source_id)
      WHERE e.vehicle_id = l.vehicle_id
        AND l.provider_id = $1
        AND COALESCE(d.end_at, d.listed_at) IS NOT NULL
        AND e.occurred_at > COALESCE(d.end_at, d.listed_at) + interval '1 day'
        AND e.occurred_at::date >= '2026-09-16'::date
        AND (
          e.metadata ILIKE '%carstat%'
          OR e.description ILIKE '%Damage:%'
          OR e.description ILIKE '%Auction end:%'
          OR e.description ILIKE '%Damage zones:%'
          OR e.description ILIKE '%Badges:%'
        )
      `,
      [providerId],
    );
    eventsUpdated = events.rowCount ?? 0;
  } catch (e) {
    console.warn("events update skipped:", e.message || e);
  }

  const check = await client.query(
    `
    SELECT
      count(*)::int AS obs,
      count(*) FILTER (WHERE o.source_listed_at IS NULL AND o.source_updated_at IS NULL)::int AS still_no_source,
      count(*) FILTER (WHERE o.source_updated_at IS NOT NULL)::int AS with_end
    FROM vehicle_observations o
    WHERE o.provider_id = $1
    `,
    [providerId],
  );

  return {
    observationsUpdated: obs.rowCount ?? 0,
    listingsUpdated: listings.rowCount ?? 0,
    eventsUpdated,
    catalogMapped: datesByLot.size,
    check: check.rows[0],
  };
}

console.log({ APPLY, TARGET, MAX_PAGES: MAX_PAGES || "all", DELAY_MS, COVERAGE_STOP, CHECKPOINT });

const probeClient = TARGET === "prod" ? new pg.Client(loadProd()) : localClient();
await probeClient.connect();
try {
  await loadNeededIds(probeClient);
} finally {
  await probeClient.end();
}

const startPage = loadCheckpoint();
await walkCatalog(startPage);
console.log(`catalog dates mapped: ${datesByLot.size} coverage=${coverage().toFixed(3)}`);

if (!APPLY) {
  console.log("Dry run — set APPLY=1 to write. Sample:", [...datesByLot.entries()].slice(0, 3));
  process.exit(0);
}

const client = TARGET === "prod" ? new pg.Client(loadProd()) : localClient();
await client.connect();
try {
  await client.query("BEGIN");
  const report = await applyDates(client);
  await client.query("COMMIT");
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  await client.end();
}
