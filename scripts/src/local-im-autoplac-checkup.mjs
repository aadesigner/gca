/**
 * Local Import Motor + Autoplac checkup (and optional auto-heal).
 *
 *   node ./scripts/src/local-im-autoplac-checkup.mjs
 *   node ./scripts/src/local-im-autoplac-checkup.mjs --fix
 *
 * Uses local Postgres with sslmode=disable. Re-kicks stalled/missing jobs when --fix.
 */
import pg from "pg";

const FIX = process.argv.includes("--fix");
const API = process.env.API_URL || "http://127.0.0.1:5000";
const CDP =
  process.env.AUTOPLAC_CDP_URL || process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const IM_JOB_ID = Number(process.env.IM_JOB_ID || 360);
const AUTOPLAC_JOB_ID = Number(process.env.AUTOPLAC_JOB_ID || 387);

const localUrl = (
  process.env.LOCAL_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip"
).replace(/[?&]sslmode=[^&]+/i, "");
const connectionString = `${localUrl}${localUrl.includes("?") ? "&" : "?"}sslmode=disable`;

const report = {
  t: new Date().toISOString(),
  ok: true,
  fixed: [],
  errors: [],
  warnings: [],
  cdp: null,
  api: null,
  providers: {},
};

function fail(msg) {
  report.ok = false;
  report.errors.push(msg);
}
function warn(msg) {
  report.warnings.push(msg);
}

async function checkCdp() {
  try {
    const ver = await (
      await fetch(`${CDP.replace(/\/$/, "")}/json/version`, { signal: AbortSignal.timeout(3000) })
    ).json();
    const tabs = await (
      await fetch(`${CDP.replace(/\/$/, "")}/json/list`, { signal: AbortSignal.timeout(3000) })
    ).json();
    report.cdp = { browser: ver.Browser, tabs: Array.isArray(tabs) ? tabs.length : 0 };
    if (!report.cdp.tabs) fail("CDP has 0 tabs — start Chrome with --remote-debugging-port=9222");
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

function ageMin(ts) {
  return (Date.now() - new Date(ts).getTime()) / 60000;
}

async function inspectProvider(c, name) {
  const jobs = (
    await c.query(
      `
      SELECT cj.id, cj.job_type, cj.status, cj.items_processed, cj.vins_found, cj.vins_new,
             cj.listings_fetched, cj.pages_processed, cj.error_message, cj.updated_at, cj.started_at,
             left(coalesce(cj.job_config,''), 220) AS cfg
      FROM collection_jobs cj
      JOIN providers p ON p.id = cj.provider_id
      WHERE p.internal_name = $1
      ORDER BY cj.updated_at DESC
      LIMIT 3
      `,
      [name],
    )
  ).rows;

  const live = jobs.find((j) => j.status === "running" || j.status === "pending");
  const issues = [];

  if (!live) {
    issues.push("no_live_job");
  } else if (live.status === "running") {
    const quiet = ageMin(live.updated_at);
    const processed = Number(live.items_processed || 0);
    if (quiet > 90 && processed === 0) issues.push(`stalled_zero_${Math.round(quiet)}m`);
    else if (quiet > 90) issues.push(`quiet_${Math.round(quiet)}m`);
  } else if (live.status === "pending" && ageMin(live.updated_at) > 45) {
    issues.push(`pending_stuck_${Math.round(ageMin(live.updated_at))}m`);
  }

  const recent = (
    await c.query(
      `
      SELECT
        count(*) FILTER (WHERE l.created_at > now() - interval '4 hours')::int AS listings_4h,
        count(*) FILTER (WHERE l.created_at > now() - interval '1 hour')::int AS listings_1h,
        count(DISTINCT v.vin) FILTER (WHERE v.vin IS NOT NULL AND l.created_at > now() - interval '4 hours')::int AS vins_4h,
        max(l.created_at) AS newest_listing
      FROM listings l
      JOIN providers p ON p.id = l.provider_id
      LEFT JOIN vehicles v ON v.id = l.vehicle_id
      WHERE p.internal_name = $1
      `,
      [name],
    )
  ).rows[0];

  report.providers[name] = {
    live: live
      ? {
          id: live.id,
          status: live.status,
          items_processed: live.items_processed,
          vins_found: live.vins_found,
          vins_new: live.vins_new,
          pages_processed: live.pages_processed,
          updated_at: live.updated_at,
          quiet_min: live.status === "running" ? Math.round(ageMin(live.updated_at)) : null,
        }
      : null,
    recent,
    issues,
  };

  for (const issue of issues) fail(`${name}: ${issue}`);
  return { live, issues };
}

async function ensureJob(c, { providerName, jobId, cfg }) {
  const provider = (
    await c.query(`SELECT id FROM providers WHERE internal_name = $1 LIMIT 1`, [providerName])
  ).rows[0];
  if (!provider) {
    fail(`${providerName}: provider missing`);
    return null;
  }

  let job = (
    await c.query(
      `
      SELECT id, status FROM collection_jobs
      WHERE id = $1 OR (provider_id = $2 AND job_type = 'full_collection')
      ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1
      `,
      [jobId, provider.id],
    )
  ).rows[0];

  if (!job) {
    const created = await c.query(
      `
      INSERT INTO collection_jobs (provider_id, job_type, status, job_config, created_at, updated_at)
      VALUES ($1, 'full_collection', 'pending', $2, now() - interval '2 days', now() - interval '1 day')
      RETURNING id, status
      `,
      [provider.id, JSON.stringify(cfg)],
    );
    job = created.rows[0];
    report.fixed.push(`${providerName}: created job #${job.id}`);
  }

  await c.query(
    `
    UPDATE collection_jobs
    SET status = 'pending',
        started_at = NULL,
        completed_at = NULL,
        error_message = NULL,
        crawl_state = CASE
          WHEN $3::boolean THEN crawl_state
          ELSE NULL
        END,
        job_config = $1,
        updated_at = now() - interval '1 day',
        created_at = LEAST(created_at, now() - interval '2 days')
    WHERE id = $2
    `,
    [JSON.stringify(cfg), job.id, providerName === "import_motor"],
  );
  report.fixed.push(`${providerName}: re-queued job #${job.id} (${cfg.concurrency}x / ${cfg.delayMs}ms)`);
  return job.id;
}

async function main() {
  const c = new pg.Client({ connectionString });
  await c.connect();
  try {
    await checkCdp();
    await checkApi();
    const im = await inspectProvider(c, "import_motor");
    const ap = await inspectProvider(c, "autoplac");

    if (FIX) {
      // Only force-kick when actually unhealthy — don't reset healthy runners.
      const imUnhealthy =
        !im.live ||
        im.issues.length > 0 ||
        ["cancelled", "failed", "completed"].includes(String(im.live?.status || ""));
      const apUnhealthy =
        !ap.live ||
        ap.issues.length > 0 ||
        ["cancelled", "failed", "completed"].includes(String(ap.live?.status || ""));

      if (imUnhealthy) {
        await ensureJob(c, {
          providerName: "import_motor",
          jobId: IM_JOB_ID,
          cfg: {
            source: "checkup_fix_im",
            concurrency: 5,
            delayMs: 85,
            retryCount: 3,
            detailLevel: "full",
            maxPages: 0,
            maxListings: 0,
            skipRecentHours: 0,
            crawlMode: "brands",
            fullCrawl: true,
            repeatHours: 5,
          },
        });
      }
      if (apUnhealthy) {
        await ensureJob(c, {
          providerName: "autoplac",
          jobId: AUTOPLAC_JOB_ID,
          cfg: {
            source: "checkup_fix_autoplac",
            concurrency: 2,
            delayMs: 1100,
            retryCount: 3,
            detailLevel: "full",
            maxPages: 0,
            maxListings: 0,
            skipRecentHours: 0,
            repeatHours: 5,
          },
        });
      }

      // Re-inspect after fixes
      if (imUnhealthy || apUnhealthy) {
        report.providers = {};
        report.errors = report.errors.filter((e) => !/import_motor:|autoplac:/.test(e));
        report.ok = report.errors.length === 0;
        await inspectProvider(c, "import_motor");
        await inspectProvider(c, "autoplac");
        report.ok = report.errors.length === 0;
      } else {
        report.fixed.push("no job requeue needed — both healthy");
      }
    }
  } finally {
    await c.end();
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
