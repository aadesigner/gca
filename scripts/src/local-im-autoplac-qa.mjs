/**
 * Local QA for Import Motor + Autoplac crawls.
 *
 * Checks job liveness, recent listings/VINs/photos, and CDP reachability.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/local-im-autoplac-qa.mjs
 */
import pg from "pg";

const API = process.env.API_URL || "http://127.0.0.1:5000";
const CDP = process.env.AUTOPLAC_CDP_URL || process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const PROVIDERS = ["import_motor", "autoplac"];

const report = {
  t: new Date().toISOString(),
  ok: true,
  errors: [],
  cdp: null,
  api: null,
  providers: {},
};

function fail(msg) {
  report.ok = false;
  report.errors.push(msg);
}

async function checkCdp() {
  try {
    const ver = await (await fetch(`${CDP.replace(/\/$/, "")}/json/version`, { signal: AbortSignal.timeout(3000) })).json();
    const tabs = await (await fetch(`${CDP.replace(/\/$/, "")}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
    report.cdp = { browser: ver.Browser, tabs: Array.isArray(tabs) ? tabs.length : 0 };
    if (!report.cdp.tabs) fail("CDP has 0 tabs");
  } catch (e) {
    report.cdp = { error: String(e.message || e) };
    fail(`CDP unreachable at ${CDP}`);
  }
}

async function checkApi() {
  try {
    const r = await fetch(`${API}/api/healthz`, { signal: AbortSignal.timeout(5000) });
    report.api = { status: r.status, ok: r.ok };
    if (!r.ok) fail(`API healthz ${r.status}`);
  } catch (e) {
    report.api = { error: String(e.message || e) };
    fail(`API unreachable at ${API}`);
  }
}

async function qaProvider(c, name) {
  const out = { jobs: [], recent: null, photos: null };

  const jobs = await c.query(
    `
    SELECT cj.id, cj.job_type, cj.status, cj.items_processed, cj.vins_found, cj.vins_new,
           cj.listings_fetched, cj.pages_processed, cj.error_message, cj.updated_at, cj.started_at
    FROM collection_jobs cj
    JOIN providers p ON p.id = cj.provider_id
    WHERE p.internal_name = $1
    ORDER BY cj.updated_at DESC
    LIMIT 3
    `,
    [name],
  );
  out.jobs = jobs.rows;

  const live = jobs.rows.find((j) => j.status === "running" || j.status === "pending");
  if (!live) fail(`${name}: no pending/running job`);
  else if (live.status === "running") {
    const ageMin = (Date.now() - new Date(live.updated_at).getTime()) / 60000;
    if (ageMin > 90 && Number(live.items_processed || 0) === 0) {
      fail(`${name}: job #${live.id} running ${Math.round(ageMin)}m with 0 items`);
    } else if (ageMin > 180) {
      fail(`${name}: job #${live.id} quiet ${Math.round(ageMin)}m (stall?)`);
    }
  }

  const recent = await c.query(
    `
    SELECT
      count(*)::int AS listings_24h,
      count(*) FILTER (WHERE l.created_at > now() - interval '4 hours')::int AS listings_4h,
      count(DISTINCT v.vin) FILTER (WHERE v.vin IS NOT NULL AND l.created_at > now() - interval '24 hours')::int AS vins_24h,
      max(l.created_at) AS newest_listing
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    LEFT JOIN vehicles v ON v.id = l.vehicle_id
    WHERE p.internal_name = $1
    `,
    [name],
  );
  out.recent = recent.rows[0];

  const photos = await c.query(
    `
    SELECT
      count(ph.id)::int AS photos_24h,
      count(ph.id) FILTER (WHERE coalesce(ph.stored_path,'') ILIKE '%imgsv%' OR coalesce(ph.stored_path,'') ILIKE '%r2%')::int AS mirrored,
      count(ph.id) FILTER (WHERE coalesce(ph.source_url, ph.stored_path, '') ~* 'logo|icon|sprite|avatar|favicon|placeholder|nophoto|warsztaty|/v1/p/dl/')::int AS junkish,
      count(ph.id) FILTER (
        WHERE $1 = 'autoplac'
          AND coalesce(ph.source_url, ph.stored_path, '') !~* 'euw2-cdn\\.autoplac\\.pl/v1/p/[0-9a-f-]{36}'
      )::int AS autoplac_non_gallery
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    JOIN photos ph ON ph.listing_id = l.id
    WHERE p.internal_name = $1
      AND l.created_at > now() - interval '24 hours'
    `,
    [name],
  );
  out.photos = photos.rows[0];
  if (name === "autoplac" && Number(out.photos?.autoplac_non_gallery || 0) > 0) {
    fail(`autoplac: ${out.photos.autoplac_non_gallery} non-gallery photo URLs on listings (suggested/junk?)`);
  }
  if (Number(out.photos?.junkish || 0) > 0) {
    fail(`${name}: ${out.photos.junkish} junkish photo URLs on listings`);
  }

  // Soft warnings for brand-new Autoplac (0 inventory yet is OK until crawl progresses).
  if (name === "import_motor" && live?.status === "running") {
    const processed = Number(live.items_processed || 0);
    const ageMin = (Date.now() - new Date(live.updated_at).getTime()) / 60000;
    // IM often updates existing vehicles — listings_4h can be 0 while items_processed grows.
    if (processed > 0 && ageMin > 90) {
      fail(`import_motor: job #${live.id} quiet ${Math.round(ageMin)}m (stall?)`);
    }
  }
  if (name === "autoplac" && live?.status === "running") {
    const processed = Number(live.items_processed || 0);
    const ageMin = (Date.now() - new Date(live.updated_at).getTime()) / 60000;
    if (processed === 0 && ageMin > 30) {
      fail(`autoplac: job #${live.id} running ${Math.round(ageMin)}m with 0 items`);
    }
  }

  const samples = await c.query(
    `
    SELECT l.source_id, left(l.title, 60) AS title, v.vin,
           (SELECT count(*)::int FROM photos ph WHERE ph.listing_id = l.id) AS photo_n
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    LEFT JOIN vehicles v ON v.id = l.vehicle_id
    WHERE p.internal_name = $1
    ORDER BY l.created_at DESC NULLS LAST
    LIMIT 3
    `,
    [name],
  );
  out.samples = samples.rows;

  report.providers[name] = out;
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  await checkCdp();
  await checkApi();
  for (const name of PROVIDERS) await qaProvider(c, name);
} finally {
  await c.end();
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
