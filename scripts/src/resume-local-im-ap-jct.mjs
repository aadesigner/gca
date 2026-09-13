/**
 * One-shot local resume after reboot:
 *  - park other collection jobs
 *  - requeue IM #360, Autoplac #387, JapaneseCarTrade #390 with crawl_state preserved
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/resume-local-im-ap-jct.mjs
 */
import pg from "pg";

const KEEP = [
  Number(process.env.IM_JOB_ID || 360),
  Number(process.env.AUTOPLAC_JOB_ID || 387),
  Number(process.env.JCT_JOB_ID || 390),
];

const PATCH = {
  360: {
    concurrency: 5,
    delayMs: 85,
    crawlMode: "countries",
    fullCrawl: true,
    detailLevel: "full",
    retryCount: 5,
    skipRecentHours: 0,
    maxPages: 0,
    maxListings: 0,
    source: "resume_local_im_ap_jct",
  },
  387: {
    concurrency: 6,
    delayMs: 220,
    fullCrawl: true,
    detailLevel: "full",
    retryCount: 3,
    skipRecentHours: 0,
    source: "resume_local_im_ap_jct",
  },
  390: {
    concurrency: 5,
    delayMs: 180,
    detailLevel: "full",
    retryCount: 3,
    skipRecentHours: 0,
    maxPages: 0,
    maxListings: 0,
    source: "resume_local_im_ap_jct",
  },
};

const c = new pg.Client({
  connectionString: (process.env.DATABASE_URL || "").includes("sslmode=")
    ? process.env.DATABASE_URL
    : `${process.env.DATABASE_URL || "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip"}?sslmode=disable`.replace(
        "?sslmode=disable?sslmode=disable",
        "?sslmode=disable",
      ),
});
await c.connect();

const parked = await c.query(
  `
  UPDATE collection_jobs
  SET status = 'cancelled',
      completed_at = COALESCE(completed_at, NOW()),
      updated_at = NOW(),
      error_message = 'parked: resume IM+Autoplac+JCT'
  WHERE status IN ('running', 'pending', 'paused')
    AND id <> ALL($1::int[])
  RETURNING id
  `,
  [KEEP],
);

const out = { parked: parked.rows.map((r) => r.id), resumed: [] };

for (const id of KEEP) {
  const row = (await c.query(`SELECT id, status, job_config, crawl_state, pages_processed, items_processed FROM collection_jobs WHERE id=$1`, [id])).rows[0];
  if (!row) {
    out.resumed.push({ id, error: "missing" });
    continue;
  }
  let cfg = {};
  try {
    cfg = row.job_config ? JSON.parse(row.job_config) : {};
  } catch {
    cfg = {};
  }
  const patch = PATCH[id] || {};
  const merged = { ...cfg, ...patch };
  delete merged.resetCrawlState;
  delete merged.nextRunAt;

  let crawlState = row.crawl_state;
  let resume = null;
  if (crawlState) {
    try {
      const st = typeof crawlState === "string" ? JSON.parse(crawlState) : crawlState;
      if (Array.isArray(st.shards)) {
        for (const s of st.shards) {
          if (s?.filters) delete s.filters.resetCrawlState;
          // Stale "active" after reboot → pending so worker continues nextPage
          if (s.status === "active" || s.status === "cooldown") {
            s.status = "pending";
            s.cooldownUntil = null;
            s.lastError = null;
          }
        }
        if (!st.currentShardId) {
          st.currentShardId = st.shards.find((s) => s.status === "pending")?.id ?? null;
        }
        const cur = st.shards.find((s) => s.id === st.currentShardId);
        resume = cur
          ? { shard: cur.id, status: cur.status, nextPage: cur.nextPage, pages: cur.pagesProcessed }
          : null;
      }
      crawlState = JSON.stringify(st);
    } catch {
      /* keep */
    }
  }

  await c.query(
    `
    UPDATE collection_jobs
    SET status = 'pending',
        started_at = NULL,
        completed_at = NULL,
        error_message = NULL,
        job_config = $2,
        crawl_state = COALESCE($3::text, crawl_state),
        updated_at = NOW() - interval '1 day',
        created_at = LEAST(created_at, NOW() - interval '2 days')
    WHERE id = $1
    `,
    [id, JSON.stringify(merged), crawlState],
  );

  out.resumed.push({
    id,
    pages: row.pages_processed,
    items: row.items_processed,
    concurrency: merged.concurrency,
    resume,
  });
}

console.log(JSON.stringify(out, null, 2));
await c.end();
