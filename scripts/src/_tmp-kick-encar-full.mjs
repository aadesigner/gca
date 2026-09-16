/**
 * Prod: solo Encar full_collection (preserve crawl_state), cancel competing Encar jobs,
 * cap parallel slots for RAM, make full due now.
 */
import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) =>
  vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n];

const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || get("POSTGRES_USER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const PARALLEL_CAP = 6;

const { rows: pinned } = await c.query(`
  SELECT j.id, j.job_type, j.status, j.updated_at,
         j.job_config, length(coalesce(j.crawl_state::text,'')) AS crawl_len,
         j.pages_processed, j.listings_fetched, j.items_processed
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE p.internal_name = 'encar'
    AND j.job_type IN ('full_collection', 'listing_refresh')
  ORDER BY
    CASE j.job_type WHEN 'full_collection' THEN 0 ELSE 1 END,
    j.id DESC
`);

const full = pinned.find((r) => r.job_type === "full_collection");
if (!full) {
  console.error("No encar full_collection job found");
  await c.end();
  process.exit(1);
}

console.log("full_before", {
  id: full.id,
  status: full.status,
  crawl_len: full.crawl_len,
  pages: full.pages_processed,
  fetched: full.listings_fetched,
  items: full.items_processed,
});

await c.query(`UPDATE settings SET max_collection_jobs_parallel = $1 WHERE id = 1`, [PARALLEL_CAP]);

// Cancel every other active Encar job (refresh extras included).
const cancel = await c.query(
  `
  UPDATE collection_jobs j
  SET status = 'cancelled',
      completed_at = COALESCE(completed_at, NOW()),
      error_message = COALESCE(error_message, 'solo encar full until complete')
  FROM providers p
  WHERE j.provider_id = p.id
    AND p.internal_name = 'encar'
    AND j.id <> $1
    AND j.status IN ('pending', 'running', 'paused')
  RETURNING j.id, j.job_type, j.status
  `,
  [full.id],
);
console.log(
  "cancelled",
  cancel.rows.map((r) => `${r.id}:${r.job_type}`),
);

let cfg = {};
try {
  cfg = typeof full.job_config === "string" ? JSON.parse(full.job_config) : full.job_config || {};
} catch {
  cfg = {};
}
const nextRunAt = new Date(Date.now() - 60_000).toISOString();
const merged = {
  ...cfg,
  detailLevel: "full",
  concurrency: Math.min(Number(cfg.concurrency) || 4, 4),
  delayMs: Math.max(Number(cfg.delayMs) || 280, 280),
  skipRecentHours: 0,
  nextRunAt,
};
delete merged.resetCrawlState;

const kick = await c.query(
  `
  UPDATE collection_jobs
  SET status = 'pending',
      job_config = $2,
      error_message = NULL,
      completed_at = NULL,
      updated_at = NOW()
  WHERE id = $1
  RETURNING id, status, pages_processed, listings_fetched,
            length(coalesce(crawl_state::text,'')) AS crawl_len,
            left(job_config, 280) AS cfg_head
  `,
  [full.id, JSON.stringify(merged)],
);
console.log("full_after", kick.rows[0]);

const parallel = await c.query(`SELECT max_collection_jobs_parallel FROM settings WHERE id = 1`);
console.log("parallel", parallel.rows[0]);

const active = await c.query(`
  SELECT p.internal_name, j.id, j.job_type, j.status,
         round(extract(epoch from (now()-j.updated_at))/60.0,1) AS quiet_m
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.status IN ('running','pending')
  ORDER BY quiet_m DESC NULLS LAST
  LIMIT 20
`);
console.log("active_top", active.rows);

await c.end();
