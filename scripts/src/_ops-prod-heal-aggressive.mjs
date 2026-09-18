/**
 * Aggressive production fleet heal:
 *  - cancel high-security / zero-yield providers (FLEET_SKIP)
 *  - kill zombie running jobs (quiet > 45m)
 *  - dedupe active jobs to one per provider
 *  - hand productive catalogs to listing_refresh NOW
 *  - strip resetCrawlState / overdue nextRunAt
 *
 *   node ./scripts/src/_ops-prod-heal-aggressive.mjs
 */
import fs from "node:fs";
import pg from "pg";

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

/** High-security / empty discover / local-CDP-only — never burn Railway slots. */
const SECURITY_SKIP = [
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
  "carpoolkr",
  "koreausedcars",
  "japanesecartrade",
  "willhaben",
  "mobilede",
  "opensooq",
];

/** Prefer refresh when they already have catalog depth. */
const REFRESH_NOW = [
  "encar",
  "autowini",
  "kbchachacha",
  "autoscout24",
  "autotraderca",
  "dubicars",
  "otomoto",
  "autovit",
  "cars24ae",
  "aaaauto",
  "sauto",
  "carpages",
  "ontariocars",
  "lotte_autoglobal",
  "kolon_auto",
  "bidexport",
  "thebidrive",
  "salvagebid",
  "bringatrailer",
  "copart",
  "nettiauto",
  "finn",
  "seobuk",
  "koreaauto_auction",
];

const report = {
  t: new Date().toISOString(),
  cancelledSkip: 0,
  killedZombies: 0,
  deduped: 0,
  handedRefresh: [],
  disabledProviders: [],
  before: {},
  after: {},
};

const c = loadProdClient();
await c.connect();
await c.query("SET statement_timeout='180s'");

const snap = async () => {
  const r = await c.query(`
    SELECT status, job_type, count(*)::int AS n
    FROM collection_jobs
    WHERE status IN ('running','pending')
    GROUP BY 1,2 ORDER BY 1,2
  `);
  return r.rows;
};
report.before = await snap();

// 1) Cancel security-skip providers + disable them so fleet won't reschedule
{
  const r = await c.query(
    `
    UPDATE collection_jobs cj
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, NOW()),
        error_message = 'security/empty crawl — fleet skip (healed)',
        updated_at = NOW()
    FROM providers p
    WHERE p.id = cj.provider_id
      AND p.internal_name = ANY($1::text[])
      AND cj.status IN ('running', 'pending', 'paused')
    RETURNING cj.id, p.internal_name
    `,
    [SECURITY_SKIP],
  );
  report.cancelledSkip = r.rowCount ?? 0;

  const dis = await c.query(
    `
    UPDATE providers
    SET enabled = false, updated_at = NOW()
    WHERE internal_name = ANY($1::text[])
      AND enabled = true
      AND internal_name = ANY($2::text[])
    RETURNING internal_name
    `,
    [
      SECURITY_SKIP,
      // Only disable the newly-skipped high-security ones (not mirrors like kmcheck if used elsewhere)
      [
        "carpoolkr",
        "koreausedcars",
        "japanesecartrade",
        "willhaben",
        "mobilede",
        "opensooq",
        "iaa",
        "che168",
        "autohome",
        "heydealer",
        "bobaedream",
        "kcar",
        "mango",
      ],
    ],
  );
  report.disabledProviders = dis.rows.map((x) => x.internal_name);
}

// 2) Kill zombie runners (quiet > 45 minutes)
{
  const r = await c.query(`
    UPDATE collection_jobs
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, NOW()),
        error_message = 'zombie runner — no progress >45m (healed)',
        updated_at = NOW()
    WHERE status = 'running'
      AND updated_at < NOW() - interval '45 minutes'
    RETURNING id
  `);
  report.killedZombies = r.rowCount ?? 0;
}

// 3) Dedupe: keep one newest active job per provider; cancel the rest
{
  const r = await c.query(`
    WITH ranked AS (
      SELECT cj.id,
             ROW_NUMBER() OVER (
               PARTITION BY cj.provider_id
               ORDER BY
                 CASE cj.status WHEN 'running' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                 CASE cj.job_type WHEN 'listing_refresh' THEN 0 ELSE 1 END,
                 cj.updated_at DESC,
                 cj.id DESC
             ) AS rn
      FROM collection_jobs cj
      WHERE cj.status IN ('running', 'pending', 'paused')
    )
    UPDATE collection_jobs cj
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, NOW()),
        error_message = 'deduped — prefer one active job (healed)',
        updated_at = NOW()
    FROM ranked r
    WHERE cj.id = r.id AND r.rn > 1
    RETURNING cj.id
  `);
  report.deduped = r.rowCount ?? 0;
}

// 4) Strip resetCrawlState + overdue nextRunAt on remaining active
await c.query(`
  UPDATE collection_jobs
  SET job_config = (
        (COALESCE(job_config,'{}')::jsonb - 'resetCrawlState' - 'nextRunAt')
        || jsonb_build_object('source', coalesce(job_config::jsonb->>'source','prod_heal_aggressive'))
      )::text,
      updated_at = LEAST(updated_at, NOW() - interval '30 minutes')
  WHERE status IN ('pending', 'running')
`);

// 5) Hand productive providers to listing_refresh NOW
for (const name of REFRESH_NOW) {
  const prov = (
    await c.query(`SELECT id, enabled FROM providers WHERE internal_name=$1`, [name])
  ).rows[0];
  if (!prov || prov.enabled === false) continue;

  const listings = (
    await c.query(
      `SELECT count(*)::int AS n FROM listings WHERE provider_id=$1`,
      [prov.id],
    )
  ).rows[0].n;

  // Need some catalog before refresh makes sense; else leave/create a lean full
  const active = await c.query(
    `
    SELECT id, job_type, status, items_processed, pages_processed
    FROM collection_jobs
    WHERE provider_id=$1 AND status IN ('running','pending')
    ORDER BY updated_at DESC
    `,
    [prov.id],
  );

  if (listings < 50 && Number(active.rows[0]?.items_processed || 0) < 50) {
    // Ensure one pending full without reset flag
    if (active.rows.length === 0) {
      const ins = await c.query(
        `
        INSERT INTO collection_jobs (provider_id, job_type, status, job_config, created_at, updated_at)
        VALUES ($1, 'full_collection', 'pending', $2, NOW()-interval '2 days', NOW()-interval '1 hour')
        RETURNING id
        `,
        [
          prov.id,
          JSON.stringify({
            detailLevel: "full",
            concurrency: 3,
            delayMs: 280,
            skipRecentHours: 0,
            maxPages: 0,
            maxListings: 0,
            repeatHours: 5,
            source: "prod_heal_seed_full",
          }),
        ],
      );
      report.handedRefresh.push({ provider: name, action: "seed_full", id: ins.rows[0].id, listings });
    }
    continue;
  }

  // Cancel active fulls so refresh can take the slot
  await c.query(
    `
    UPDATE collection_jobs
    SET status='cancelled', completed_at=COALESCE(completed_at,NOW()),
        error_message='healed: switch to listing_refresh',
        updated_at=NOW()
    WHERE provider_id=$1 AND status IN ('running','pending','paused') AND job_type='full_collection'
    `,
    [prov.id],
  );

  const existingRefresh = (
    await c.query(
      `
      SELECT id FROM collection_jobs
      WHERE provider_id=$1 AND job_type='listing_refresh'
      ORDER BY updated_at DESC LIMIT 1
      `,
      [prov.id],
    )
  ).rows[0];

  const cfg = JSON.stringify({
    detailLevel: "standard",
    concurrency: 4,
    delayMs: 220,
    skipRecentHours: 2,
    maxPages: 0,
    maxListings: 0,
    repeatHours: 5,
    source: "prod_heal_aggressive_refresh",
  });

  if (existingRefresh) {
    await c.query(
      `
      UPDATE collection_jobs
      SET status='pending', job_type='listing_refresh', job_config=$2,
          started_at=NULL, completed_at=NULL, error_message=NULL,
          crawl_state=NULL,
          created_at=LEAST(created_at, NOW()-interval '3 days'),
          updated_at=NOW()-interval '1 hour'
      WHERE id=$1
      `,
      [existingRefresh.id, cfg],
    );
    report.handedRefresh.push({ provider: name, action: "requeue_refresh", id: existingRefresh.id, listings });
  } else {
    const ins = await c.query(
      `
      INSERT INTO collection_jobs (provider_id, job_type, status, job_config, created_at, updated_at)
      VALUES ($1, 'listing_refresh', 'pending', $2, NOW()-interval '2 days', NOW()-interval '1 hour')
      RETURNING id
      `,
      [prov.id, cfg],
    );
    report.handedRefresh.push({ provider: name, action: "create_refresh", id: ins.rows[0].id, listings });
  }
}

report.after = await snap();
const live = await c.query(`
  SELECT cj.id, p.internal_name, cj.job_type, cj.status, cj.items_processed, cj.pages_processed,
         ROUND(EXTRACT(EPOCH FROM (now()-cj.updated_at))/60.0,1) AS quiet_min
  FROM collection_jobs cj
  JOIN providers p ON p.id=cj.provider_id
  WHERE cj.status IN ('running','pending')
  ORDER BY cj.status, p.internal_name
`);
report.live = live.rows;
report.parallel = (
  await c.query(`SELECT max_collection_jobs_parallel FROM settings LIMIT 1`)
).rows[0];

console.log(JSON.stringify(report, null, 2));
await c.end();
