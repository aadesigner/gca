/**
 * Restrict Import Motor job 360 to Balkans + Georgia until those shards finish.
 * Preserves existing shard progress; parks every other country.
 */
import pg from "pg";

const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const API = process.env.API_URL || "http://127.0.0.1:5000";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

/** Balkans + Georgia (buyer destination). */
const FOCUS = [
  "me", // Montenegro
  "mk", // North Macedonia
  "xk", // Kosovo
  "ba", // Bosnia
  "al", // Albania
  "si", // Slovenia
  "hr", // Croatia
  "bg", // Bulgaria
  "rs", // Serbia
  "ro", // Romania
  "gr", // Greece
  "ge", // Georgia
];

async function login() {
  const res = await fetch(`${API}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function apiJson(cookie, method, urlPath, body) {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${urlPath} → ${res.status} ${text.slice(0, 200)}`);
  return json;
}

async function waitPaused(pool, id, ms = 90_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const { rows } = await pool.query(`SELECT status FROM collection_jobs WHERE id = $1`, [id]);
    if (rows[0]?.status === "paused") return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`job ${id} did not pause in time`);
}

function shardCc(shard) {
  const fromFilters = shard.filters?.countries?.[0];
  if (fromFilters) return String(fromFilters).toLowerCase();
  const m = /^im-(rest|[a-z]{2})$/.exec(shard.id || "");
  return m ? (m[1] === "rest" ? "*rest" : m[1]) : null;
}

async function main() {
  if (!email || !password) throw new Error("ADMIN_EMAIL/ADMIN_PASSWORD required");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const cookie = await login();

  try {
    // Free DB headroom so IM can persist VINs (recent timeouts were dropping cars).
    for (const id of [361, 362]) {
      try {
        await apiJson(cookie, "POST", `/api/admin/jobs/${id}/pause`, {});
        console.log(`paused Encar ${id}`);
      } catch (e) {
        console.warn(`pause ${id}: ${e.message}`);
      }
    }

    let job = await apiJson(cookie, "GET", `/api/admin/jobs/${JOB_ID}`);
    console.log(`IM ${JOB_ID} before status=${job.status} pages=${job.pagesProcessed} vins=${job.vinsFound}`);

    if (job.status === "running" || job.status === "pending") {
      await apiJson(cookie, "POST", `/api/admin/jobs/${JOB_ID}/pause`, {});
      await waitPaused(pool, JOB_ID);
    }

    const { rows } = await pool.query(
      `SELECT job_config, crawl_state FROM collection_jobs WHERE id = $1`,
      [JOB_ID],
    );
    const cfg = JSON.parse(rows[0].job_config || "{}");
    const state = JSON.parse(rows[0].crawl_state || "null");
    if (!state?.shards?.length) throw new Error("missing crawl_state shards");

    cfg.countries = FOCUS;
    cfg.fullCrawl = true;
    cfg.fullCrawlCountries = FOCUS;
    cfg.skipRecentHours = 0;
    cfg.maxPages = 0;
    cfg.maxListings = 0;
    cfg.concurrency = Math.min(16, Number(process.env.IMPORT_MOTOR_CONCURRENCY || 16) || 16);
    cfg.delayMs = Math.max(50, Number(process.env.IMPORT_MOTOR_DELAY_MS || 70) || 70);
    cfg.retryCount = 5;
    cfg.detailLevel = "full";
    delete cfg.origins;
    delete cfg.nextRunAt;

    const focusSet = new Set(FOCUS);
    const byId = new Map(state.shards.map((s) => [s.id, s]));
    const ordered = [];

    for (const cc of FOCUS) {
      const id = `im-${cc}`;
      let shard = byId.get(id);
      if (!shard) {
        shard = {
          id,
          label: cc.toUpperCase(),
          filters: { ...cfg, countries: [cc], fullCrawl: true },
          status: "pending",
          nextPage: 1,
          pagesProcessed: 0,
          itemsDiscovered: 0,
          listingsFetched: 0,
          discoverFailures: 0,
          cooldownUntil: null,
          lastError: null,
        };
      } else {
        shard.filters = {
          ...(shard.filters ?? {}),
          ...cfg,
          countries: [cc],
          fullCrawl: true,
        };
        delete shard.filters.origins;
        if (shard.status === "cooldown") {
          shard.status = "pending";
          shard.cooldownUntil = null;
        }
        if (shard.status !== "completed") {
          shard.status = "pending";
          shard.discoverFailures = 0;
          if (shard.lastError?.includes("0 VINs") || shard.lastError?.includes("Cloudflare")) {
            shard.lastError = null;
          }
        }
      }
      ordered.push(shard);
    }

    let parked = 0;
    for (const shard of state.shards) {
      const cc = shardCc(shard);
      if (cc && focusSet.has(cc)) continue;
      if (ordered.some((s) => s.id === shard.id)) continue;
      shard.status = "completed";
      shard.lastError = "deferred: Balkans+Georgia first";
      shard.cooldownUntil = null;
      ordered.push(shard);
      parked++;
    }

    state.shards = ordered;
    state.currentShardId =
      ordered.find((s) => focusSet.has(shardCc(s)) && s.status !== "completed")?.id ??
      ordered.find((s) => s.status === "pending" || s.status === "active")?.id ??
      "im-al";

    const focus = ordered.filter((s) => focusSet.has(shardCc(s)));
    console.log(
      "focus shards:",
      focus.map(
        (s) =>
          `${shardCc(s)}:${s.status}:p${s.pagesProcessed}/${s.expectedTotalPages ?? "?"}:d${s.itemsDiscovered}:f${s.listingsFetched}`,
      ),
    );
    console.log(`parked ${parked} non-focus shards; next=${state.currentShardId}`);

    await pool.query(
      `UPDATE collection_jobs
       SET job_type = 'full_collection',
           job_config = $1,
           crawl_state = $2,
           status = 'paused',
           completed_at = NULL,
           error_message = NULL,
           updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(cfg), JSON.stringify(state), JOB_ID],
    );

    job = await apiJson(cookie, "POST", `/api/admin/jobs/${JOB_ID}/resume`, {
      resetProgress: false,
      jobType: "full_collection",
      filterParams: {
        fullCrawl: true,
        countries: FOCUS,
        fullCrawlCountries: FOCUS,
        concurrency: cfg.concurrency,
        delayMs: cfg.delayMs,
        skipRecentHours: 0,
        maxPages: 0,
        maxListings: 0,
        retryCount: 5,
        detailLevel: "full",
      },
    });
    console.log(`resumed IM ${JOB_ID} → ${job.status}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
