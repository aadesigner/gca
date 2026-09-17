/**
 * Local Import Motor + Autoplac + Carstat checkup (optional auto-heal).
 * JapaneseCarTrade is paused (Carstat priority) — never re-queue it here.
 *
 *   node ./scripts/src/local-im-autoplac-checkup.mjs
 *   node ./scripts/src/local-im-autoplac-checkup.mjs --fix
 *
 * Always preserves crawl_state (resume where left off). Never sets resetCrawlState.
 */
import pg from "pg";

const FIX = process.argv.includes("--fix");
const API = process.env.API_URL || "http://127.0.0.1:5000";
const CDP =
  process.env.AUTOPLAC_CDP_URL ||
  process.env.IMPORT_MOTOR_CDP_URL ||
  process.env.CARSTAT_CDP_URL ||
  "http://127.0.0.1:9222";
const IM_JOB_ID = Number(process.env.IM_JOB_ID || 360);
const AUTOPLAC_JOB_ID = Number(process.env.AUTOPLAC_JOB_ID || 387);
const CARSTAT_JOB_ID = Number(process.env.CARSTAT_JOB_ID || 414);

const localUrl = (
  process.env.LOCAL_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip"
).replace(/[?&]sslmode=[^&]+/i, "");
const connectionString = `${localUrl}${localUrl.includes("?") ? "&" : "?"}sslmode=disable`;

const PROVIDERS = [
  {
    name: "import_motor",
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
      crawlMode: "countries",
      // Full catalog — Korean list cards prioritized first within each page (preferOrigins).
      fullCrawl: true,
      preferOrigins: ["korean"],
      repeatHours: 5,
    },
  },
  {
    name: "autoplac",
    jobId: AUTOPLAC_JOB_ID,
    cfg: {
      source: "checkup_fix_autoplac",
      concurrency: 6,
      delayMs: 220,
      retryCount: 3,
      detailLevel: "full",
      maxPages: 0,
      maxListings: 0,
      skipRecentHours: 0,
      fullCrawl: true,
      repeatHours: 5,
    },
  },
  {
    name: "carstat",
    jobId: CARSTAT_JOB_ID,
    cfg: {
      source: "checkup_fix_carstat",
      concurrency: 6,
      delayMs: 180,
      retryCount: 3,
      detailLevel: "full",
      maxPages: 0,
      maxListings: 0,
      skipRecentHours: 0,
      fullCrawl: true,
      repeatHours: 5,
    },
  },
];

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

function ageMin(ts) {
  return (Date.now() - new Date(ts).getTime()) / 60000;
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

function parseCrawlState(raw) {
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/** Import Motor preserves completed shards across repeatHours — reopen for the next country cycle. */
function allImShardsCompleted(crawlState) {
  const shards = crawlState?.shards;
  if (!Array.isArray(shards) || shards.length === 0) return false;
  const imShards = shards.filter((s) => String(s?.id || "").startsWith("im-"));
  if (imShards.length === 0) return false;
  return imShards.every((s) => s.status === "completed");
}

function reopenImCountryShards(crawlState, cfgPatch = {}) {
  const st = crawlState && typeof crawlState === "object" ? { ...crawlState, shards: [...(crawlState.shards || [])] } : { shards: [] };
  st.shards = (st.shards || []).map((s) => {
    if (!String(s?.id || "").startsWith("im-")) return s;
    if (s.status !== "completed" && s.status !== "cooldown" && s.status !== "active") return s;
    const filters = {
      ...(s.filters || {}),
      crawlMode: "countries",
      fullCrawl: true,
      preferOrigins: cfgPatch.preferOrigins || ["korean"],
      detailLevel: "full",
      skipRecentHours: 0,
    };
    delete filters.origins;
    return {
      ...s,
      status: "pending",
      nextPage: 1,
      lastError: null,
      cooldownUntil: null,
      filters,
    };
  });
  st.currentShardId = st.shards.find((s) => s.status === "pending")?.id || null;
  return st;
}

async function inspectProvider(c, name) {
  const jobs = (
    await c.query(
      `
      SELECT cj.id, cj.job_type, cj.status, cj.items_processed, cj.vins_found, cj.vins_new,
             cj.listings_fetched, cj.pages_processed, cj.error_message, cj.updated_at, cj.started_at,
             cj.crawl_state,
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

  if (name === "import_motor" && live) {
    const st = parseCrawlState(live.crawl_state);
    if (allImShardsCompleted(st)) {
      issues.push("im_cycle_complete_all_shards");
    }
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

function mergeJobConfig(existingRaw, patch) {
  let existing = {};
  try {
    existing = existingRaw ? (typeof existingRaw === "string" ? JSON.parse(existingRaw) : existingRaw) : {};
  } catch {
    existing = {};
  }
  const merged = { ...existing, ...patch };
  delete merged.resetCrawlState;
  delete merged.nextRunAt;
  if (merged.fullCrawl === true) delete merged.origins;
  return merged;
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
      SELECT id, status, job_config, crawl_state
      FROM collection_jobs
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
      RETURNING id, status, job_config, crawl_state
      `,
      [provider.id, JSON.stringify(cfg)],
    );
    job = created.rows[0];
    report.fixed.push(`${providerName}: created job #${job.id}`);
  }

  const merged = mergeJobConfig(job.job_config, cfg);

  // Preserve crawl_state always. Only clear resetCrawlState flags inside shards if present.
  // When all IM country shards are completed, reopen them for the next 4–5h cycle.
  let crawlState = job.crawl_state;
  if (crawlState) {
    try {
      let st = typeof crawlState === "string" ? JSON.parse(crawlState) : crawlState;
      if (providerName === "import_motor" && allImShardsCompleted(st)) {
        st = reopenImCountryShards(st, cfg);
        report.fixed.push(`${providerName}: reopened ${st.shards?.length || 0} country shards for next cycle`);
      }
      if (Array.isArray(st?.shards)) {
        for (const s of st.shards) {
          if (s?.filters && typeof s.filters === "object") delete s.filters.resetCrawlState;
          // Keep IM shard filters aligned with fullCrawl job patch (worker can stale-overwrite).
          if (providerName === "import_motor" && merged.fullCrawl === true && s?.filters) {
            s.filters.fullCrawl = true;
            s.filters.preferOrigins = merged.preferOrigins || ["korean"];
            delete s.filters.origins;
          }
          // Stale active/cooldown after API restart → pending so worker continues
          if (s.status === "active" || s.status === "cooldown") {
            s.status = "pending";
            s.cooldownUntil = null;
            s.lastError = null;
          }
        }
        if (!st.currentShardId) {
          st.currentShardId = st.shards.find((s) => s.status === "pending")?.id ?? null;
        }
      }
      crawlState = JSON.stringify(st);
    } catch {
      /* keep as-is */
    }
  }

  await c.query(
    `
    UPDATE collection_jobs
    SET status = 'pending',
        started_at = NULL,
        completed_at = NULL,
        error_message = NULL,
        crawl_state = COALESCE($3::text, crawl_state),
        job_config = $1,
        updated_at = now() - interval '1 day',
        created_at = LEAST(created_at, now() - interval '2 days')
    WHERE id = $2
    `,
    [JSON.stringify(merged), job.id, crawlState],
  );
  report.fixed.push(
    `${providerName}: re-queued job #${job.id} (${merged.concurrency}x / ${merged.delayMs}ms, crawl_state preserved)`,
  );
  return job.id;
}

async function main() {
  const c = new pg.Client({ connectionString });
  await c.connect();
  try {
    await checkCdp();
    await checkApi();

    const inspected = {};
    for (const p of PROVIDERS) {
      inspected[p.name] = await inspectProvider(c, p.name);
    }

    if (FIX) {
      let anyFix = false;
      for (const p of PROVIDERS) {
        const live = inspected[p.name].live;
        const unhealthy =
          !live ||
          inspected[p.name].issues.length > 0 ||
          ["cancelled", "failed", "completed"].includes(String(live?.status || ""));
        if (unhealthy) {
          anyFix = true;
          await ensureJob(c, {
            providerName: p.name,
            jobId: p.jobId,
            cfg: p.cfg,
          });
        }
      }

      if (anyFix) {
        report.providers = {};
        report.errors = report.errors.filter(
          (e) => !/import_motor:|autoplac:|carstat:/.test(e),
        );
        report.ok = report.errors.length === 0;
        for (const p of PROVIDERS) await inspectProvider(c, p.name);
        report.ok = report.errors.length === 0;
      } else {
        report.fixed.push("no job requeue needed — all healthy");
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
