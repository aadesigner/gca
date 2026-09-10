/**
 * Quick production post-deploy check.
 * node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-postdeploy-check.mjs
 */
import pg from "pg";

const API = process.env.PROD_API_URL || "https://getcarapi.com";

async function probe(path) {
  const started = Date.now();
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* ignore */
    }
    return {
      path,
      status: res.status,
      ms: Date.now() - started,
      body: json ?? text.slice(0, 200),
    };
  } catch (err) {
    return { path, status: 0, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
}

const healthPaths = ["/api/health", "/health", "/api/ready", "/ready"];
const probes = [];
for (const p of healthPaths) {
  const r = await probe(p);
  probes.push(r);
  if (r.status >= 200 && r.status < 500) break;
}

const site = await probe("/");
const account = await probe("/account/");

const client = new pg.Client({
  host: process.env.PROD_PG_HOST,
  port: Number(process.env.PROD_PG_PORT || 5432),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
  ssl: process.env.PROD_PG_SSL === "1" ? { rejectUnauthorized: false } : false,
});

await client.connect();

const migrations = await client.query(`
  SELECT id, hash, created_at
  FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC NULLS LAST, id DESC
  LIMIT 8
`);

const smtpCols = await client.query(`
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'settings' AND column_name = 'smtp_enabled'
  ) AS smtp_ready,
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'password_reset_tokens'
  ) AS reset_table
`);

const smtp = await client.query(`
  SELECT smtp_enabled, smtp_host, smtp_port, smtp_from_email,
         (smtp_password IS NOT NULL AND length(smtp_password) > 0) AS has_pw,
         email_password_reset_enabled, email_public_base_url
  FROM settings WHERE id = 1
`);

const jobTypes = await client.query(`
  SELECT job_type, status, count(*)::int AS n
  FROM collection_jobs
  WHERE status IN ('pending', 'running', 'paused')
  GROUP BY 1, 2
  ORDER BY 1, 2
`);

const activeJobs = await client.query(`
  SELECT p.internal_name, cj.id, cj.job_type, cj.status,
         cj.items_processed, cj.pages_processed,
         cj.updated_at,
         (cj.crawl_state IS NULL) AS fresh_state,
         left(coalesce(cj.error_message, ''), 80) AS err
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE cj.status IN ('pending', 'running')
  ORDER BY
    CASE cj.status WHEN 'running' THEN 0 ELSE 1 END,
    p.internal_name
`);

const skippedRunning = await client.query(`
  SELECT p.internal_name, cj.id, cj.job_type, cj.status
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE cj.status IN ('pending', 'running')
    AND p.internal_name = ANY($1::text[])
  ORDER BY p.internal_name
`, [[
  "import_motor", "iaa", "che168", "autohome", "mango", "ssancar",
  "heydealer", "bobaedream", "kcar", "autobell", "ams",
]]);

const recentFails = await client.query(`
  SELECT p.internal_name, cj.id, cj.job_type, cj.status,
         left(coalesce(cj.error_message, ''), 120) AS err,
         cj.completed_at
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE cj.status = 'failed'
    AND cj.updated_at > NOW() - interval '2 hours'
  ORDER BY cj.updated_at DESC
  LIMIT 10
`);

const parallel = await client.query(`
  SELECT max_collection_jobs_parallel FROM settings WHERE id = 1
`);

await client.end();

const full = activeJobs.rows.filter((r) => r.job_type === "full_collection");
const refresh = activeJobs.rows.filter((r) => r.job_type === "listing_refresh");
const running = activeJobs.rows.filter((r) => r.status === "running");
const stale = running.filter((r) => {
  const age = Date.now() - new Date(r.updated_at).getTime();
  return age > 30 * 60 * 1000;
});

console.log(
  JSON.stringify(
    {
      api: { probes, siteStatus: site.status, accountStatus: account.status },
      migrations: {
        latest: migrations.rows[0] ?? null,
        recentTagsHint: migrations.rows.map((r) => ({ id: r.id, created_at: r.created_at })),
        smtpCols: smtpCols.rows[0],
      },
      smtp: smtp.rows[0],
      parallel: parallel.rows[0]?.max_collection_jobs_parallel,
      jobSummary: jobTypes.rows,
      counts: {
        active: activeJobs.rows.length,
        full: full.length,
        refresh: refresh.length,
        running: running.length,
        staleRunning30m: stale.length,
      },
      runningNow: running.map((r) => ({
        provider: r.internal_name,
        id: r.id,
        type: r.job_type,
        processed: r.items_processed,
        pages: r.pages_processed,
        fresh: r.fresh_state,
        updatedAt: r.updated_at,
      })),
      pendingSample: activeJobs.rows
        .filter((r) => r.status === "pending")
        .slice(0, 15)
        .map((r) => ({
          provider: r.internal_name,
          id: r.id,
          type: r.job_type,
          fresh: r.fresh_state,
        })),
      skippedStillActive: skippedRunning.rows,
      recentFails: recentFails.rows,
      refreshActive: refresh.map((r) => ({
        provider: r.internal_name,
        id: r.id,
        status: r.status,
        processed: r.items_processed,
      })),
    },
    null,
    2,
  ),
);
