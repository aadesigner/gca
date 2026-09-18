/**
 * Queue new providers + harden Encar full, without blowing Railway parallel/RAM.
 *
 * - Cap parallel at 8 (not 12+)
 * - BeForward: slow crawl (conc 1) — already in LISTING_REFRESH_FOLLOWUP
 * - JUC / Syarah: enable + pending full at conc 1 (low VIN yield; wait in queue)
 * - Encar #552: force detailLevel=full, moderate concurrency, skipRecentHours=0
 * - Soften pending boost configs that are concurrency≥4 for HTML marketplaces
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-queue-new-and-harden.mjs
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

const SAFE = {
  beforward: { delayMs: 1800, concurrency: 1, retryCount: 4, detailLevel: "full", skipRecentHours: 0 },
  japaneseusedcars: { delayMs: 1200, concurrency: 1, retryCount: 2, detailLevel: "full", skipRecentHours: 0 },
  syarah: { delayMs: 900, concurrency: 1, retryCount: 2, detailLevel: "full", skipRecentHours: 0 },
  encar: { delayMs: 500, concurrency: 3, retryCount: 3, detailLevel: "full", skipRecentHours: 0 },
};

const c = new pg.Client(loadProd());
await c.connect();

const report = { actions: [], warnings: [] };

// 1) Parallel cap — enough for fleet, not a RAM stampede
const par = await c.query(`
  UPDATE settings
  SET max_collection_jobs_parallel = LEAST(GREATEST(COALESCE(max_collection_jobs_parallel, 0), 7), 8)
  WHERE id = 1
  RETURNING max_collection_jobs_parallel
`);
report.actions.push({ parallel: par.rows[0].max_collection_jobs_parallel });

// 2) Harden running Encar full
const encarHard = await c.query(
  `
  UPDATE collection_jobs cj
  SET job_config = (
        COALESCE(cj.job_config::jsonb, '{}'::jsonb)
        || $1::jsonb
        || jsonb_build_object(
             'maxPages', 0,
             'maxListings', 0,
             'resetCrawlState', false
           )
      )::text,
      updated_at = now()
  FROM providers pr
  WHERE pr.id = cj.provider_id
    AND pr.internal_name = 'encar'
    AND cj.status = 'running'
    AND cj.job_type = 'full_collection'
  RETURNING cj.id, cj.status,
    cj.job_config::jsonb->>'detailLevel' AS d,
    cj.job_config::jsonb->>'concurrency' AS conc,
    cj.job_config::jsonb->>'delayMs' AS delay
`,
  [JSON.stringify(SAFE.encar)],
);
report.actions.push({ encar_hardened: encarHard.rows });

if (!encarHard.rowCount) {
  // Ensure a pending/running full exists
  const { rows: encarProv } = await c.query(`SELECT id FROM providers WHERE internal_name='encar'`);
  const active = await c.query(
    `SELECT id, status FROM collection_jobs WHERE provider_id=$1 AND job_type='full_collection' AND status IN ('pending','running')`,
    [encarProv[0].id],
  );
  if (!active.rows.length) {
    const cfg = {
      ...SAFE.encar,
      maxPages: 0,
      maxListings: 0,
      resetCrawlState: true,
      nextRunAt: new Date().toISOString(),
      repeatHours: 5,
    };
    const created = await c.query(
      `INSERT INTO collection_jobs (provider_id, job_type, status, job_config)
       VALUES ($1,'full_collection','pending',$2)
       RETURNING id`,
      [encarProv[0].id, JSON.stringify(cfg)],
    );
    report.actions.push({ encar_created: created.rows[0] });
  }
}

// 3) Enable + queue new providers (pending — wait for free slots)
for (const name of ["beforward", "japaneseusedcars", "syarah"]) {
  await c.query(`UPDATE providers SET enabled = true, updated_at = now() WHERE internal_name = $1`, [name]);
  const { rows: prov } = await c.query(`SELECT id FROM providers WHERE internal_name = $1`, [name]);
  if (!prov[0]) {
    report.warnings.push(`missing provider ${name}`);
    continue;
  }
  const existing = await c.query(
    `
    SELECT id, status FROM collection_jobs
    WHERE provider_id = $1 AND job_type = 'full_collection'
      AND status IN ('pending','running','paused')
    ORDER BY id DESC LIMIT 1
  `,
    [prov[0].id],
  );
  const cfg = {
    ...SAFE[name],
    maxPages: 0,
    maxListings: 0,
    resetCrawlState: true,
    nextRunAt: new Date().toISOString(),
    repeatHours: 6,
    // BeForward hands off to listing_refresh after full (worker LISTING_REFRESH_FOLLOWUP).
    // JUC/Syarah intentionally do not — public VIN yield is near zero.
  };
  if (existing.rows[0]) {
    const u = await c.query(
      `
      UPDATE collection_jobs
      SET status = 'pending',
          job_type = 'full_collection',
          job_config = $1::text,
          crawl_state = NULL,
          error_message = NULL,
          completed_at = NULL,
          updated_at = now()
      WHERE id = $2
      RETURNING id, status
    `,
      [JSON.stringify(cfg), existing.rows[0].id],
    );
    report.actions.push({ provider: name, reused: u.rows[0] });
  } else {
    const created = await c.query(
      `
      INSERT INTO collection_jobs (provider_id, job_type, status, job_config)
      VALUES ($1, 'full_collection', 'pending', $2)
      RETURNING id, status
    `,
      [prov[0].id, JSON.stringify(cfg)],
    );
    report.actions.push({ provider: name, created: created.rows[0] });
  }
}

// 4) Soften pending HTML/full jobs that were boost-configured to concurrency ≥4
//    (keeps queue RAM-friendly when they claim). Skip API-heavy copart if pending.
const softened = await c.query(`
  UPDATE collection_jobs cj
  SET job_config = (
        COALESCE(cj.job_config::jsonb, '{}'::jsonb)
        || jsonb_build_object(
             'concurrency', LEAST(COALESCE((cj.job_config::jsonb->>'concurrency')::int, 4), 2),
             'delayMs', GREATEST(COALESCE((cj.job_config::jsonb->>'delayMs')::int, 400), 400)
           )
      )::text,
      updated_at = now()
  FROM providers pr
  WHERE pr.id = cj.provider_id
    AND cj.status = 'pending'
    AND cj.job_type = 'full_collection'
    AND pr.internal_name NOT IN ('copart', 'import_motor', 'encar', 'beforward', 'japaneseusedcars', 'syarah')
    AND COALESCE((cj.job_config::jsonb->>'concurrency')::int, 0) >= 4
  RETURNING cj.id, pr.internal_name,
    cj.job_config::jsonb->>'concurrency' AS conc
`);
report.actions.push({ softened_pending: softened.rows.length, rows: softened.rows.slice(0, 20) });

// 5) Ensure pending detailLevel=full for marketplace fulls stuck on standard
const detailFix = await c.query(`
  UPDATE collection_jobs cj
  SET job_config = jsonb_set(
        COALESCE(cj.job_config::jsonb, '{}'::jsonb),
        '{detailLevel}', '"full"'::jsonb, true
      )::text,
      updated_at = now()
  FROM providers pr
  WHERE pr.id = cj.provider_id
    AND cj.status IN ('pending','running')
    AND cj.job_type = 'full_collection'
    AND pr.internal_name IN (
      'encar','beforward','japaneseusedcars','syarah','autowini','kbchachacha',
      'aaaauto','carpages','seobuk','thebidrive','sauto','autoscout24'
    )
    AND COALESCE(cj.job_config::jsonb->>'detailLevel','') <> 'full'
  RETURNING cj.id, pr.internal_name, cj.job_config::jsonb->>'detailLevel' AS d
`);
report.actions.push({ detail_level_fixed: detailFix.rows });

const active = await c.query(`
  SELECT cj.id, pr.internal_name, cj.job_type, cj.status,
    cj.job_config::jsonb->>'detailLevel' AS d,
    cj.job_config::jsonb->>'concurrency' AS conc,
    cj.items_processed
  FROM collection_jobs cj
  JOIN providers pr ON pr.id = cj.provider_id
  WHERE cj.status IN ('pending','running')
    AND pr.internal_name IN (
      'encar','beforward','japaneseusedcars','syarah'
    )
  ORDER BY pr.internal_name, cj.id DESC
`);
report.active_targets = active.rows;

const slots = await c.query(`
  SELECT
    (SELECT max_collection_jobs_parallel FROM settings ORDER BY id LIMIT 1) AS parallel,
    (SELECT count(*)::int FROM collection_jobs WHERE status='running') AS running,
    (SELECT count(*)::int FROM collection_jobs WHERE status='pending') AS pending
`);
report.slots = slots.rows[0];

console.log(JSON.stringify(report, null, 2));
await c.end();
