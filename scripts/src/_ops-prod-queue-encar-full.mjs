/**
 * Queue Encar full_collection (detailLevel=full). Does not cancel existing Encar jobs.
 * Bumps parallel slots so the priority claim can start.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

function loadProd() {
  const p = path.join(os.tmpdir(), "gca-pg-vars-prod.json");
  const raw = fs.readFileSync(p, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) =>
    vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n];
  return {
    host: get("RAILWAY_TCP_PROXY_DOMAIN") || "yamanote.proxy.rlwy.net",
    port: Number(get("RAILWAY_TCP_PROXY_PORT") || 15622),
    user: get("PGUSER") || get("POSTGRES_USER") || "postgres",
    password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
    database: get("PGDATABASE") || "railway",
    ssl: false,
  };
}

const c = new pg.Client(loadProd());
await c.connect();

const existing = await c.query(`
  SELECT cj.id, cj.status, cj.job_type,
    cj.job_config::jsonb->>'detailLevel' AS detail_level,
    cj.items_processed
  FROM collection_jobs cj
  JOIN providers pr ON pr.id = cj.provider_id
  WHERE pr.internal_name = 'encar'
    AND cj.status IN ('pending', 'running', 'paused')
  ORDER BY cj.id DESC
`);
console.log("existing", existing.rows);

const activeFull = existing.rows.find(
  (r) => r.job_type === "full_collection" && (r.status === "pending" || r.status === "running"),
);
if (activeFull) {
  // Ensure detailLevel=full + resetCrawlState on pending
  if (activeFull.status === "pending") {
    await c.query(
      `
      UPDATE collection_jobs
      SET job_config = jsonb_set(
            jsonb_set(
              COALESCE(job_config::jsonb, '{}'::jsonb),
              '{detailLevel}', '"full"'::jsonb, true
            ),
            '{resetCrawlState}', 'true'::jsonb, true
          )::text,
          crawl_state = NULL,
          updated_at = now()
      WHERE id = $1
    `,
      [activeFull.id],
    );
  }
  console.log("keeping", activeFull.id);
} else {
  const { rows: prov } = await c.query(`SELECT id FROM providers WHERE internal_name = 'encar'`);
  const cfg = JSON.stringify({
    detailLevel: "full",
    delayMs: 500,
    concurrency: 3,
    retryCount: 3,
    skipRecentHours: 0,
    maxPages: 0,
    maxListings: 0,
    resetCrawlState: true,
    nextRunAt: new Date().toISOString(),
  });
  const created = await c.query(
    `
    INSERT INTO collection_jobs (provider_id, job_type, status, job_config)
    VALUES ($1, 'full_collection', 'pending', $2)
    RETURNING id, status, job_config::jsonb->>'detailLevel' AS detail_level
  `,
    [prov[0].id, cfg],
  );
  console.log("created", created.rows);
}

await c.query(`
  UPDATE settings
  SET max_collection_jobs_parallel = GREATEST(COALESCE(max_collection_jobs_parallel, 0), 12)
  WHERE id = 1
`);
const settings = await c.query(`SELECT max_collection_jobs_parallel FROM settings WHERE id = 1`);
console.log("parallel", settings.rows[0]);

const after = await c.query(`
  SELECT cj.id, cj.status, cj.job_type,
    cj.job_config::jsonb->>'detailLevel' AS d,
    cj.items_processed, (cj.crawl_state IS NOT NULL) AS has_state
  FROM collection_jobs cj
  JOIN providers pr ON pr.id = cj.provider_id
  WHERE pr.internal_name = 'encar' AND cj.status IN ('pending','running','paused')
`);
console.log("encar_active", after.rows);
await c.end();
