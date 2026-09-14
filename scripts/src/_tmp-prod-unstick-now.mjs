/**
 * Immediate prod fleet unstick: requeue quiet runners + clear overdue nextRunAt.
 * Quiet threshold = 5 minutes (synchronized freeze pattern).
 */
import fs from "node:fs";
import pg from "pg";

const QUIET_MIN = Number(process.env.QUIET_MIN || 5);

function loadProdClient() {
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => {
    const v = vars[n];
    return v && typeof v === "object" && "value" in v ? v.value : v;
  };
  return new pg.Client({
    host: get("RAILWAY_TCP_PROXY_DOMAIN"),
    port: Number(get("RAILWAY_TCP_PROXY_PORT")),
    user: get("PGUSER") || get("POSTGRES_USER") || "postgres",
    password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
    database: get("PGDATABASE") || get("POSTGRES_DB") || "railway",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 25000,
  });
}

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
  "import_motor",
  "autoplac",
  "auctionauto",
  "carpoolkr",
  "koreausedcars",
  "japanesecartrade",
  "willhaben",
  "mobilede",
  "opensooq",
]);

const c = loadProdClient();
await c.connect();
const report = { t: new Date().toISOString(), quietMin: QUIET_MIN };

await c.query(`UPDATE settings SET max_collection_jobs_parallel = 8, updated_at = NOW() WHERE id = 1`);
report.parallel = 8;

// Cancel fleet-skip providers eating slots
const skipped = await c.query(
  `
  UPDATE collection_jobs j
  SET status = 'cancelled',
      completed_at = COALESCE(completed_at, NOW()),
      updated_at = NOW(),
      error_message = 'fleet skip / local-only — unstick cancel'
  FROM providers p
  WHERE j.provider_id = p.id
    AND j.status IN ('running', 'pending')
    AND p.internal_name = ANY($1::text[])
  RETURNING j.id, p.internal_name
  `,
  [[...FLEET_SKIP]],
);
report.cancelledSkip = skipped.rows.map((r) => `${r.internal_name}#${r.id}`);

// Requeue quiet runners
const stale = await c.query(
  `
  UPDATE collection_jobs j
  SET status = 'pending',
      started_at = NULL,
      completed_at = NULL,
      error_message = 'ops: unstick quiet runner',
      job_config = (
        jsonb_set(
          COALESCE(NULLIF(j.job_config, '')::jsonb, '{}'::jsonb),
          '{nextRunAt}',
          to_jsonb(to_char(NOW() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        )
        #- '{resetCrawlState}'
      )::text,
      updated_at = NOW()
  WHERE j.status = 'running'
    AND j.updated_at < NOW() - ($1 || ' minutes')::interval
  RETURNING j.id,
    (SELECT internal_name FROM providers p WHERE p.id = j.provider_id) AS name,
    round(extract(epoch from (NOW() - j.updated_at))/60)::int AS was_quiet_m
  `,
  [String(QUIET_MIN)],
);
report.requeuedQuiet = stale.rows.map((r) => `${r.name}#${r.id}`);

// Dedupe pending: keep one per provider (prefer newest)
const dups = await c.query(`
  WITH ranked AS (
    SELECT j.id,
           ROW_NUMBER() OVER (
             PARTITION BY j.provider_id
             ORDER BY j.updated_at DESC NULLS LAST, j.id DESC
           ) AS rn
    FROM collection_jobs j
    WHERE j.status = 'pending'
  )
  UPDATE collection_jobs j
  SET status = 'cancelled',
      completed_at = NOW(),
      updated_at = NOW(),
      error_message = 'ops: cancel duplicate pending (unstick)'
  FROM ranked r
  WHERE j.id = r.id AND r.rn > 1
  RETURNING j.id
`);
report.cancelledDupPending = dups.rowCount;

// Clear overdue nextRunAt on remaining pending so workers claim immediately
const due = await c.query(`
  UPDATE collection_jobs j
  SET job_config = (
        jsonb_set(
          COALESCE(NULLIF(j.job_config, '')::jsonb, '{}'::jsonb),
          '{nextRunAt}',
          to_jsonb(to_char(NOW() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        )
        #- '{resetCrawlState}'
      )::text,
      updated_at = NOW(),
      created_at = LEAST(created_at, NOW() - interval '2 hours')
  WHERE j.status = 'pending'
  RETURNING j.id,
    (SELECT internal_name FROM providers p WHERE p.id = j.provider_id) AS name
`);
report.pendingDueNow = due.rows.map((r) => `${r.name}#${r.id}`);

const snap = await c.query(`
  SELECT j.status, count(*)::int AS n
  FROM collection_jobs j
  WHERE j.status IN ('running','pending')
  GROUP BY 1 ORDER BY 1
`);
report.statusCounts = Object.fromEntries(snap.rows.map((r) => [r.status, r.n]));

console.log(JSON.stringify(report, null, 2));
await c.end();
