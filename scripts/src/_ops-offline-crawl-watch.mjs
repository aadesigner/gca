/**
 * Keep Encar + Carstat full and Import Motor healthy. Hold everything else.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-offline-crawl-watch.mjs
 */
import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query(`UPDATE settings SET max_collection_jobs_parallel = 3 WHERE id = 1`);

const extras = await c.query(`
  UPDATE collection_jobs
  SET status = 'paused',
      error_message = 'paused — Encar/Carstat/IM only',
      job_config = (
        jsonb_set(
          COALESCE(NULLIF(job_config, '')::jsonb, '{}'::jsonb),
          '{pausedForMirrorDrain}',
          'true'::jsonb
        )
      )::text,
      updated_at = now()
  WHERE status IN ('running', 'pending')
    AND id NOT IN (360, 362, 414)
  RETURNING id
`);

function yearOf(id) {
  const m = String(id).match(/year-(\d{4})/i);
  return m ? Number(m[1]) : 0;
}

async function patch(id, mutate) {
  const row = await c.query(
    `SELECT status, job_config, crawl_state, updated_at FROM collection_jobs WHERE id = $1`,
    [id],
  );
  if (!row.rows[0]) throw new Error(`job ${id} missing`);
  const cfg = JSON.parse(row.rows[0].job_config || "{}");
  const st = JSON.parse(row.rows[0].crawl_state || "{}");
  const ageMs = row.rows[0].updated_at ? Date.now() - new Date(row.rows[0].updated_at).getTime() : 1e12;
  const stuck =
    row.rows[0].status !== "running" ||
    ageMs > 12 * 60 * 1000 ||
    /fetch failed|aborted|401|403|Cloudflare/i.test(String(st.lastBlock?.message || ""));
  const info = mutate(cfg, st, row.rows[0].status) || {};
  delete cfg.nextRunAt;
  info.was = row.rows[0].status;
  info.stuck = stuck;
  if (!stuck && row.rows[0].status === "running") {
    await c.query(
      `UPDATE collection_jobs SET job_config = $1, crawl_state = $2, error_message = NULL, updated_at = now() WHERE id = $3`,
      [JSON.stringify(cfg), JSON.stringify(st), id],
    );
    info.action = "tuned-running";
    return info;
  }
  if (row.rows[0].status === "running") {
    await c.query(`UPDATE collection_jobs SET status = 'paused' WHERE id = $1 AND status = 'running'`, [id]);
    await new Promise((r) => setTimeout(r, 2000));
  }
  await c.query(
    `UPDATE collection_jobs
     SET status = 'pending',
         job_config = $1,
         crawl_state = $2,
         error_message = NULL,
         completed_at = NULL,
         updated_at = now()
     WHERE id = $3`,
    [JSON.stringify(cfg), JSON.stringify(st), id],
  );
  info.action = "requeued";
  return info;
}

const im = await patch(360, (cfg, st) => {
  cfg.crawlMode = "brands";
  cfg.fullCrawl = true;
  cfg.detailLevel = "full";
  cfg.concurrency = 2;
  cfg.delayMs = Math.max(500, Number(cfg.delayMs) || 500);
  cfg.skipRecentHours = 0;
  cfg.maxPages = 0;
  cfg.maxListings = 0;
  let reset = 0;
  for (const s of st.shards || []) {
    const err = String(s.lastError || "");
    const walled = /catalog wall|401|403|Unauthorized|not readable|Cloudflare|challenge/i.test(err);
    const fakeEof = s.status === "completed" && Number(s.pagesProcessed) === 5 && Number(s.nextPage) === 6;
    if ((s.status === "completed" || s.status === "cooldown") && (walled || fakeEof)) {
      s.status = "pending";
      s.lastError = null;
      s.cooldownUntil = null;
      s.expectedTotalPages = null;
      s.expectedResultTotal = null;
      s.discoverFailures = 0;
      reset += 1;
    }
    if (s.status === "cooldown" && s.cooldownUntil && Date.parse(s.cooldownUntil) <= Date.now()) {
      s.status = "pending";
      s.cooldownUntil = null;
    }
    if (s.filters && typeof s.filters === "object") {
      s.filters.concurrency = 2;
      s.filters.delayMs = 500;
      s.filters.detailLevel = "full";
    }
  }
  st.currentShardId = null;
  if (st.lastBlock && /401|403|Cloudflare|not readable/i.test(String(st.lastBlock.message || ""))) {
    st.lastBlock = null;
  }
  return { wallReset: reset };
});

const en = await patch(362, (cfg, st) => {
  cfg.fullCrawl = true;
  cfg.detailLevel = "full";
  cfg.sort = "ModifiedDate";
  cfg.maxEncarConcurrency = 2;
  cfg.minGapMs = 500;
  cfg.concurrency = 2;
  cfg.delayMs = Math.max(400, Number(cfg.delayMs) || 400);
  cfg.skipRecentHours = 0;
  cfg.maxPages = 0;
  cfg.maxListings = 0;
  let cooled = 0;
  for (const s of st.shards || []) {
    if (s.status === "cooldown" || /fetch failed|aborted|ECONNRESET|socket/i.test(String(s.lastError || ""))) {
      s.status = "pending";
      s.lastError = null;
      s.cooldownUntil = null;
      s.discoverFailures = 0;
      cooled += 1;
    }
  }
  st.shards = (st.shards || []).slice().sort((a, b) => yearOf(b.id) - yearOf(a.id));
  st.currentShardId = null;
  st.lastBlock = null;
  return { unstuck: cooled };
});

const cs = await patch(414, (cfg, st) => {
  cfg.fullCrawl = true;
  cfg.detailLevel = "full";
  cfg.concurrency = 2;
  cfg.delayMs = Math.max(400, Number(cfg.delayMs) || 400);
  cfg.skipRecentHours = 0;
  cfg.maxPages = 0;
  cfg.maxListings = 0;
  cfg.vinOnly = true;
  let reset = false;
  for (const s of st.shards || []) {
    if (s.status === "completed") {
      s.status = "pending";
      s.nextPage = 1;
      s.pagesProcessed = 0;
      s.lastError = null;
      s.cooldownUntil = null;
      reset = true;
    }
  }
  st.currentShardId = st.shards?.[0]?.id ?? "all";
  return { newFullPass: reset };
});

const jobs = await c.query(`
  SELECT id, status, pages_processed, items_processed, vins_new, updated_at
  FROM collection_jobs WHERE id IN (360, 362, 414) ORDER BY id
`);
console.log(
  JSON.stringify(
    {
      parallel: 3,
      held: extras.rows.map((r) => r.id),
      im,
      en,
      cs,
      jobs: jobs.rows,
    },
    null,
    2,
  ),
);
await c.end();
