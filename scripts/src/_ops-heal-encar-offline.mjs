/**
 * Local-only Encar full-crawl healer. Keeps job 362 moving, pauses other jobs,
 * does not wipe crawl progress unless the job is dead/completed.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-heal-encar-offline.mjs
 */
import pg from "pg";

const url = process.env.DATABASE_URL || "";
if (!url) throw new Error("DATABASE_URL is not set");
const host = (() => {
  try {
    return new URL(url.replace(/^postgres(ql)?:/i, "http:")).hostname;
  } catch {
    return "";
  }
})();
if (!/^(localhost|127\.0\.0\.1|::1)$/i.test(host) || /rlwy\.net|railway\.(app|internal)/i.test(url)) {
  throw new Error(`Refusing Encar heal — DATABASE_URL host is "${host || "(unknown)"}", not local`);
}

const c = new pg.Client({ connectionString: url });
await c.connect();

const { rows: prov } = await c.query(`SELECT id FROM providers WHERE internal_name = 'encar' LIMIT 1`);
if (!prov[0]) {
  await c.end();
  throw new Error("No encar provider row");
}

let job = (
  await c.query(
    `
    SELECT id, status, job_type, job_config, crawl_state, error_message, updated_at,
           items_discovered, listings_fetched, pages_processed, vins_new, items_failed
    FROM collection_jobs
    WHERE provider_id = $1 AND job_type = 'full_collection'
    ORDER BY CASE WHEN id = 362 THEN 0 ELSE 1 END, id
    LIMIT 1
    `,
    [prov[0].id],
  )
).rows[0];

if (!job) {
  await c.end();
  throw new Error("No Encar full_collection job");
}

const extras = await c.query(
  `
  UPDATE collection_jobs
  SET status = 'paused',
      error_message = COALESCE(error_message, 'paused — Encar offline full'),
      updated_at = now()
  WHERE status IN ('running', 'pending')
    AND id <> $1
  RETURNING id
  `,
  [job.id],
);

await c.query(`UPDATE settings SET max_collection_jobs_parallel = 1 WHERE id = 1`);

const cfg = JSON.parse(job.job_config || "{}");
cfg.sort = cfg.sort || "ModifiedDate";
cfg.carType = cfg.carType || "all";
cfg.detailLevel = "full";
cfg.skipRecentHours = 0;
cfg.maxPages = 0;
cfg.maxListings = 0;
cfg.delayMs = cfg.delayMs ?? 80;
cfg.concurrency = Math.min(6, Math.max(2, Number(cfg.concurrency) || 6));
cfg.maxEncarConcurrency = Math.min(8, Math.max(2, Number(cfg.maxEncarConcurrency) || 8));
cfg.minGapMs = cfg.minGapMs ?? 60;
cfg.retryCount = cfg.retryCount ?? 4;
cfg.pageSize = 50;
delete cfg.nextRunAt;
delete cfg.resetCrawlState;
delete cfg.pausedForMirrorDrain;

const st = job.crawl_state ? JSON.parse(job.crawl_state) : null;
const ageMs = job.updated_at ? Date.now() - new Date(job.updated_at).getTime() : 1e12;
const blockMsg = String(st?.lastBlock?.message || job.error_message || "");
const blocked = /407|403|429|fetch failed|aborted|timeout|hard_block|Cloudflare/i.test(blockMsg);
const stuck =
  job.status !== "running" ||
  ageMs > 20 * 60 * 1000 ||
  blocked && ageMs > 8 * 60 * 1000 ||
  job.status === "failed" ||
  job.status === "completed" ||
  job.status === "paused" ||
  job.status === "cancelled";

let action = "ok-running";
if (stuck) {
  if (job.status === "running") {
    await c.query(`UPDATE collection_jobs SET status = 'paused' WHERE id = $1 AND status = 'running'`, [job.id]);
    await new Promise((r) => setTimeout(r, 1500));
  }
  const wipeState = job.status === "completed" || job.status === "cancelled";
  await c.query(
    `
    UPDATE collection_jobs
    SET status = 'pending',
        job_type = 'full_collection',
        job_config = $1,
        crawl_state = $2,
        completed_at = NULL,
        error_message = NULL,
        updated_at = now() - interval '5 minutes'
    WHERE id = $3
    `,
    [JSON.stringify(cfg), wipeState ? null : job.crawl_state, job.id],
  );
  action = wipeState ? "requeued-fresh" : "requeued-resume";
} else {
  await c.query(
    `UPDATE collection_jobs SET job_config = $1, error_message = NULL WHERE id = $2`,
    [JSON.stringify(cfg), job.id],
  );
}

const photos = await c.query(`
  SELECT
    count(*)::int AS encar_photos_3h,
    count(*) FILTER (
      WHERE ph.stored_path ~* 'imgsv\\.getcarapi\\.com|cloudflare|r2\\.cloudflarestorage'
    )::int AS mirrored_3h,
    count(*) FILTER (
      WHERE ph.stored_path ILIKE 'mirror-failed:%'
    )::int AS failed_3h,
    count(*) FILTER (
      WHERE ph.stored_path IS NULL OR btrim(ph.stored_path) = ''
    )::int AS pending_3h
  FROM photos ph
  JOIN listings l ON l.id = ph.listing_id
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'encar'
    AND ph.created_at > now() - interval '3 hours'
`);

const after = await c.query(
  `
  SELECT id, status, pages_processed, listings_fetched, vins_new, items_failed, updated_at
  FROM collection_jobs WHERE id = $1
  `,
  [job.id],
);

console.log(
  JSON.stringify(
    {
      host,
      action,
      paused: extras.rows.map((r) => r.id),
      stuck,
      blocked,
      quietMin: Math.round(ageMs / 60000),
      job: after.rows[0],
      photos: photos.rows[0],
      mirrorOn: process.env.R2_MIRROR_ON_CRAWL || "(unset)",
    },
    null,
    2,
  ),
);
await c.end();
