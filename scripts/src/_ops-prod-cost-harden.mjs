/**
 * Immediate production cost harden (no redeploy required for DB/job caps):
 * - Cap parallel crawls to 4
 * - Park excess running jobs (keep highest-priority)
 * - Stretch pending nextRunAt so fleet does not stampede
 *
 * Mirror backfill must be stopped via Railway env + redeploy (see printed vars).
 *
 *   node --import ./load-env.mjs ./src/_ops-prod-cost-harden.mjs
 *   DRY=1 node --import ./load-env.mjs ./src/_ops-prod-cost-harden.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const DRY = process.env.DRY === "1";
const TARGET_PARALLEL = Math.max(2, Number(process.env.COST_PARALLEL || 4) || 4);

function loadProd() {
  const p = path.join(os.tmpdir(), "gca-pg-vars-prod.json");
  const raw = fs.readFileSync(p, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) =>
    vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n];
  return {
    host: get("RAILWAY_TCP_PROXY_DOMAIN"),
    port: Number(get("RAILWAY_TCP_PROXY_PORT") || 5432),
    user: get("PGUSER") || get("POSTGRES_USER") || "postgres",
    password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
    database: get("PGDATABASE") || "railway",
    ssl: false,
  };
}

const KEEP = new Set(["encar", "copart", "autowini", "kbchachacha"]);

const c = new pg.Client(loadProd());
await c.connect();

const before = await c.query(`
  SELECT j.id, p.internal_name, j.status, j.job_type,
    ROUND(EXTRACT(EPOCH FROM (now()-j.updated_at))/60)::int AS quiet_min
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.status = 'running'
  ORDER BY
    CASE WHEN p.internal_name = ANY($1::text[]) THEN 0 ELSE 1 END,
    j.updated_at DESC
`, [[...KEEP]]);

console.log("running before", before.rows.length, before.rows.map((r) => `${r.internal_name}#${r.id}`));

if (!DRY) {
  await c.query(
    `UPDATE settings SET max_collection_jobs_parallel = $1, updated_at = now() WHERE id = 1`,
    [TARGET_PARALLEL],
  );
}

const keepIds = before.rows.slice(0, TARGET_PARALLEL).map((r) => r.id);
const yieldIds = before.rows.slice(TARGET_PARALLEL).map((r) => r.id);

if (yieldIds.length && !DRY) {
  const far = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  await c.query(
    `
    UPDATE collection_jobs
    SET status = 'pending',
        started_at = NULL,
        completed_at = NULL,
        error_message = 'cost harden — parked excess parallel slot',
        job_config = (
          COALESCE(job_config::jsonb, '{}'::jsonb)
          || jsonb_build_object('nextRunAt', $1::text)
        )::text,
        updated_at = now()
    WHERE id = ANY($2::int[])
    `,
    [far, yieldIds],
  );
}

// Stretch stampeding pending jobs slightly so they do not all claim at once
if (!DRY) {
  await c.query(`
    UPDATE collection_jobs j
    SET job_config = (
      COALESCE(j.job_config::jsonb, '{}'::jsonb)
      || jsonb_build_object(
        'nextRunAt',
        (now() + (random() * interval '90 minutes'))::text
      )
    )::text,
    updated_at = now()
    WHERE j.status = 'pending'
      AND j.id <> ALL($1::int[])
      AND (
        j.job_config IS NULL
        OR j.job_config::jsonb->>'nextRunAt' IS NULL
        OR (j.job_config::jsonb->>'nextRunAt')::timestamptz < now() + interval '5 minutes'
      )
  `, [keepIds.length ? keepIds : [0]]);
}

const after = await c.query(`
  SELECT
    (SELECT count(*)::int FROM collection_jobs WHERE status='running') AS running,
    (SELECT count(*)::int FROM collection_jobs WHERE status='pending') AS pending,
    (SELECT max_collection_jobs_parallel FROM settings ORDER BY id LIMIT 1) AS parallel
`);

const photos = await c.query(`
  SELECT count(*)::bigint AS total,
    count(*) FILTER (WHERE stored_path IS NOT NULL AND btrim(stored_path)<>'')::bigint AS on_cdn,
    count(*) FILTER (WHERE stored_path IS NULL OR btrim(stored_path)='')::bigint AS pending_mirror
  FROM photos
`);

console.log(DRY ? "[dry-run]" : "[applied]", {
  keepIds,
  yielded: yieldIds,
  after: after.rows[0],
  photos: photos.rows[0],
});

console.log(`
=== Railway env (set + redeploy ASAP — stops the egress fire) ===
COLLECTION_JOBS_PARALLEL=${TARGET_PARALLEL}
R2_MIRROR_BACKFILL_ON_BOOT=0
R2_MIRROR_VEHICLE_CONCURRENCY=2
R2_MIRROR_BATCH_CONCURRENCY=2
R2_MIRROR_BACKFILL_CONCURRENCY=2
R2_MIRROR_VEHICLES_PER_BATCH=4
R2_MIRROR_VEHICLE_PARALLEL=1
R2_MIRROR_ACTIVE_MS=30000
R2_MIRROR_IDLE_MS=90000
R2_MIRROR_BACKFILL_GAP_MS=8000
R2_MIRROR_MAX_PER_VEHICLE=1

Optional nuclear (pause ALL auto CDN uploads until bill cools):
R2_MIRROR_ON_CRAWL=0
`);

await c.end();
