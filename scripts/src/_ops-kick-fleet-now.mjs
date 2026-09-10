/**
 * Kick production fleet NOW:
 * - parallel = 8
 * - requeue zombie running jobs (quiet updated_at)
 * - every enabled non-skip provider: one pending job due soon
 *   full_collection if thin inventory; else listing_refresh when preferred
 * - repeatHours 5 or 6
 * - older created_at so newly queued jobs claim next free slots
 *
 * Usage (from scripts/):
 *   node --import ./load-env.mjs ./src/_ops-kick-fleet-now.mjs
 */
import pg from "pg";

const FLEET_SKIP = new Set([
  "getcarapi",
  "kmcheck",
  "kmcheck_manual",
  "carstat",
  "bidcars",
  "carsandbids",
  "ams",
  "che168",
  "autohome",
  "ssancar",
  "heydealer",
  "bobaedream",
  "bobaedreamcyber",
  "autobell",
  "kcar",
  "mango",
  "auctionwini",
  "automobileit",
  "autoscout24_es",
  "autoscout24_be",
  "autotradernl",
  "subito",
  "standvirtual",
  "mobilebg",
  "iaa",
  // Needs CDP + IMPORT_MOTOR_ON_PRODUCTION=1 on Railway — do not auto-kick.
  "import_motor",
]);

/** Match crawl-schedule FLEET_LISTING_REFRESH_PROVIDERS — updates after full. */
const PREFER_REFRESH = new Set([
  "encar",
  "autowini",
  "kbchachacha",
  "autoscout24",
  "autotraderca",
  "dubicars",
  "otomoto",
  "cars24ae",
  "aaaauto",
  "autoplac",
  "sauto",
  "willhaben",
  "carpages",
  "ontariocars",
  "lotte_autoglobal",
  "kolon_auto",
  "charancha",
  "autohub",
  "carpoolkr",
  "mobilede",
  "bidexport",
  "thebidrive",
  "japanesecartrade",
  "salvagebid",
  "bringatrailer",
  "copart",
  "auctionauto",
  "seobuk",
  "koreaauto_auction",
  "koreausedcars",
  "lotteautoauction",
  "autoinside",
  "autobellglobal",
  "rbautotrade",
  "senaauto",
]);

const STALE_MINUTES = 90;
const THIN_LISTINGS = 80;

function desiredType(_internalName, _listingCount) {
  // Full-coverage campaign: always full_collection. listing_refresh is handed
  // off by the worker after each full completes.
  return "full_collection";
}

function repeatHoursFor(name) {
  const overrides = {
    encar: 5,
    import_motor: 5,
    copart: 4,
    thebidrive: 4,
    bidexport: 5,
    ontariocars: 5,
    autoplac: 5,
  };
  if (overrides[name] != null) return overrides[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return [4, 5, 6][h % 3];
}

const client = new pg.Client({
  host: process.env.PROD_PG_HOST,
  port: Number(process.env.PROD_PG_PORT || 5432),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
  ssl: process.env.PROD_PG_SSL === "1" ? { rejectUnauthorized: false } : false,
});

if (!process.env.PROD_PG_HOST || !process.env.PROD_PG_PASSWORD) {
  console.error("Need PROD_PG_HOST and PROD_PG_PASSWORD");
  process.exit(1);
}

await client.connect();

await client.query(`
  UPDATE settings
  SET max_collection_jobs_parallel = 8, updated_at = NOW()
  WHERE id = 1
`);
console.log("parallel=8");

const stale = await client.query(
  `
  UPDATE collection_jobs j
  SET status = 'pending',
      started_at = NULL,
      completed_at = NULL,
      error_message = 'ops: requeued stale running (quiet updated_at)',
      job_config = jsonb_set(
        COALESCE(NULLIF(j.job_config, '')::jsonb, '{}'::jsonb),
        '{nextRunAt}',
        to_jsonb(to_char(NOW() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      )::text,
      updated_at = NOW()
  WHERE j.status = 'running'
    AND j.updated_at < NOW() - ($1 || ' minutes')::interval
  RETURNING j.id,
    (SELECT internal_name FROM providers p WHERE p.id = j.provider_id) AS name
  `,
  [String(STALE_MINUTES)],
);
console.log(
  "requeued_stale",
  stale.rowCount,
  stale.rows.map((r) => `${r.name}#${r.id}`),
);

const providers = await client.query(`
  SELECT p.id, p.internal_name,
         (SELECT COUNT(*)::int FROM listings l WHERE l.provider_id = p.id) AS listing_count,
         (SELECT COUNT(*)::int FROM collection_jobs j
           WHERE j.provider_id = p.id AND j.status = 'running') AS running_n
  FROM providers p
  WHERE p.enabled = true
  ORDER BY p.internal_name
`);

const actions = [];
let i = 0;
for (const p of providers.rows) {
  if (FLEET_SKIP.has(p.internal_name)) continue;

  const jobType = desiredType(p.internal_name, p.listing_count);
  const rh = repeatHoursFor(p.internal_name);
  const staggerSec = (i % 40) * 8;
  i += 1;

  if (p.running_n > 0) {
    const run = await client.query(
      `
      SELECT j.id, j.job_type, j.items_discovered, j.updated_at, j.started_at
      FROM collection_jobs j
      WHERE j.provider_id = $1 AND j.status = 'running'
      ORDER BY j.started_at ASC NULLS LAST
      LIMIT 1
      `,
      [p.id],
    );
    const r = run.rows[0];
    if (r) {
      const quietMs = Date.now() - new Date(r.updated_at).getTime();
      const disc = Number(r.items_discovered ?? 0);
      const startedAge = r.started_at ? Date.now() - new Date(r.started_at).getTime() : 0;
      const stuckEmpty =
        disc === 0 && startedAge > 45 * 60 * 1000 && quietMs < STALE_MINUTES * 60_000;

      if (stuckEmpty) {
        await client.query(
          `
          UPDATE collection_jobs
          SET status = 'cancelled', completed_at = NOW(),
              error_message = 'ops: cancelled empty stuck runner', updated_at = NOW()
          WHERE id = $1
          `,
          [r.id],
        );
        actions.push({ name: p.internal_name, action: "cancel_empty_runner", disc });
      } else {
        await client.query(
          `
          UPDATE collection_jobs
          SET status = 'cancelled', completed_at = NOW(),
              error_message = 'ops: cancelled duplicate pending while running', updated_at = NOW()
          WHERE provider_id = $1 AND status = 'pending'
          `,
          [p.id],
        );
        // Ensure runner has repeatHours for 5–6h handoff after finish
        await client.query(
          `
          UPDATE collection_jobs
          SET job_config = (
                jsonb_set(
                  COALESCE(NULLIF(job_config, '')::jsonb, '{}'::jsonb),
                  '{repeatHours}',
                  to_jsonb($2::int)
                ) - 'nextRunAt'
              )::text,
              updated_at = NOW()
          WHERE id = $1
          `,
          [r.id, rh],
        );
        actions.push({
          name: p.internal_name,
          action: "keep_running",
          jobType: r.job_type,
          disc,
          repeatHours: rh,
        });
        continue;
      }
    }
  }

  await client.query(
    `
    UPDATE collection_jobs
    SET status = 'cancelled', completed_at = NOW(),
        error_message = 'ops: fleet kick replace', updated_at = NOW()
    WHERE provider_id = $1 AND status IN ('pending', 'running')
    `,
    [p.id],
  );

  const nextRunAt = new Date(Date.now() + staggerSec * 1000).toISOString();
  const createdAt = new Date(Date.now() - (10_000 - i) * 60_000).toISOString();
  const jobConfig = JSON.stringify({
    repeatHours: rh,
    nextRunAt,
    source: "ops_kick_fleet_now",
  });

  const ins = await client.query(
    `
    INSERT INTO collection_jobs (
      provider_id, job_type, status, job_config, created_at, updated_at
    ) VALUES (
      $1, $2, 'pending', $3, $4::timestamptz, NOW()
    )
    RETURNING id
    `,
    [p.id, jobType, jobConfig, createdAt],
  );

  actions.push({
    name: p.internal_name,
    action: "queued",
    jobType,
    listings: p.listing_count,
    repeatHours: rh,
    nextRunAt,
    jobId: ins.rows[0]?.id,
  });
}

const summary = await client.query(`
  SELECT status, COUNT(*)::int AS n
  FROM collection_jobs
  WHERE status IN ('pending', 'running')
  GROUP BY status
  ORDER BY status
`);

const dueSoon = await client.query(`
  SELECT p.internal_name, j.job_type, j.id, j.status,
         ROUND(EXTRACT(EPOCH FROM (NOW() - j.updated_at))/60)::int AS quiet_min
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.status IN ('pending', 'running')
  ORDER BY j.status, p.internal_name
`);

const queued = actions.filter((a) => a.action === "queued");
const byType = {};
for (const a of queued) byType[a.jobType] = (byType[a.jobType] ?? 0) + 1;

console.log(
  JSON.stringify(
    {
      byType,
      jobStatus: summary.rows,
      keepRunning: actions.filter((a) => a.action === "keep_running"),
      cancelledEmpty: actions.filter((a) => a.action === "cancel_empty_runner"),
      queuedCount: queued.length,
      sampleQueued: queued.slice(0, 20),
      active: dueSoon.rows,
    },
    null,
    2,
  ),
);

await client.end();
