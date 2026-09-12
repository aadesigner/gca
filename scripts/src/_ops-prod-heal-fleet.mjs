/**
 * Heal production crawls:
 *  - cancel fleet-skip / local-only (autoplac, auctionauto, …)
 *  - providers with a completed full → pending listing_refresh (run now)
 *  - clear overdue nextRunAt so refresh isn't blocked
 *  - leave healthy running jobs alone
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-heal-fleet.mjs
 */
import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => {
    const v = vars[n];
    return v && typeof v === "object" && "value" in v ? v.value : v;
  };
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
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
]);

const REFRESH_AFTER_FULL = [
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
  "seobuk",
  "koreaauto_auction",
  "koreausedcars",
  "lotteautoauction",
  "autoinside",
  "autobellglobal",
  "rbautotrade",
  "senaauto",
];

const c = new pg.Client({
  connectionString: loadProdUrl(),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 25000,
  statement_timeout: 180000,
});
await c.connect();

const report = { cancelledSkip: [], handedToRefresh: [], clearedNext: 0, running: [], pending: 0 };

// 1) Cancel skip providers
{
  const r = await c.query(
    `
    UPDATE collection_jobs cj
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, NOW()),
        error_message = COALESCE(error_message, 'fleet skip / local-only — healed'),
        updated_at = NOW()
    FROM providers p
    WHERE p.id = cj.provider_id
      AND p.internal_name = ANY($1::text[])
      AND cj.status IN ('running', 'pending', 'paused')
    RETURNING cj.id, p.internal_name
    `,
    [[...FLEET_SKIP]],
  );
  report.cancelledSkip = r.rows;
}

// 2) Clear overdue nextRunAt on all pending
{
  const r = await c.query(`
    UPDATE collection_jobs
    SET job_config = (COALESCE(job_config,'{}')::jsonb - 'nextRunAt')::text,
        updated_at = NOW() - interval '30 minutes'
    WHERE status = 'pending'
      AND job_config::jsonb ? 'nextRunAt'
      AND (job_config::jsonb->>'nextRunAt')::timestamptz < NOW() + interval '5 minutes'
    RETURNING id
  `);
  report.clearedNext = r.rowCount ?? 0;
}

// 3) For each refresh-capable provider: if latest completed is full_collection
//    (or full is stuck completed with no active refresh), ensure listing_refresh pending NOW.
for (const name of REFRESH_AFTER_FULL) {
  const prov = await c.query(`SELECT id FROM providers WHERE internal_name=$1 AND enabled=true`, [name]);
  if (!prov.rows[0]) continue;
  const providerId = prov.rows[0].id;

  const active = await c.query(
    `
    SELECT id, job_type, status, items_processed
    FROM collection_jobs
    WHERE provider_id=$1 AND status IN ('running','pending','paused')
    ORDER BY updated_at DESC
    `,
    [providerId],
  );

  const latest = await c.query(
    `
    SELECT id, job_type, status, items_processed, completed_at
    FROM collection_jobs
    WHERE provider_id=$1
    ORDER BY COALESCE(completed_at, updated_at) DESC NULLS LAST
    LIMIT 1
    `,
    [providerId],
  );
  const last = latest.rows[0];

  const hasActiveRefresh = active.rows.some((r) => r.job_type === "listing_refresh");
  const hasActiveFull = active.rows.some((r) => r.job_type === "full_collection" && r.status === "running");

  // Healthy: already running full (let it finish → handoff) or running refresh
  if (hasActiveFull) continue;
  if (active.rows.some((r) => r.job_type === "listing_refresh" && r.status === "running")) continue;

  const shouldRefresh =
    (last?.job_type === "full_collection" && last.status === "completed") ||
    (last?.job_type === "listing_refresh" && ["completed", "failed", "cancelled"].includes(last.status)) ||
    (Number(last?.items_processed || 0) > 100 && !hasActiveRefresh);

  if (!shouldRefresh && active.rows.length > 0) {
    // Unblock existing pending refresh
    for (const row of active.rows.filter((r) => r.job_type === "listing_refresh" && r.status === "pending")) {
      await c.query(
        `
        UPDATE collection_jobs
        SET job_config = (
              COALESCE(job_config,'{}')::jsonb
              - 'nextRunAt'
              || jsonb_build_object(
                   'detailLevel', 'standard',
                   'repeatHours', 5,
                   'skipRecentHours', 3,
                   'source', 'prod_heal_unblock',
                   'nextRunAt', to_jsonb((NOW() - interval '1 minute')::text)
                 )
            )::text,
            status = 'pending',
            started_at = NULL,
            error_message = NULL,
            updated_at = NOW() - interval '1 hour'
        WHERE id = $1
        `,
        [row.id],
      );
      report.handedToRefresh.push({ id: row.id, provider: name, action: "unblocked" });
    }
    continue;
  }

  if (!shouldRefresh) continue;

  // Cancel extra pending fulls so refresh can claim the slot
  await c.query(
    `
    UPDATE collection_jobs
    SET status='cancelled', completed_at=COALESCE(completed_at,NOW()),
        error_message=COALESCE(error_message,'healed: prefer listing_refresh after full'),
        updated_at=NOW()
    WHERE provider_id=$1 AND status IN ('pending','paused') AND job_type='full_collection'
    `,
    [providerId],
  );

  const existingRefresh = active.rows.find((r) => r.job_type === "listing_refresh")
    ?? (
      await c.query(
        `SELECT id FROM collection_jobs WHERE provider_id=$1 AND job_type='listing_refresh' ORDER BY updated_at DESC LIMIT 1`,
        [providerId],
      )
    ).rows[0];

  const cfg = JSON.stringify({
    detailLevel: "standard",
    repeatHours: 5,
    skipRecentHours: 3,
    concurrency: 4,
    delayMs: 250,
    maxPages: 0,
    maxListings: 0,
    source: "prod_heal_full_to_refresh",
    nextRunAt: new Date(Date.now() - 60_000).toISOString(),
  });

  if (existingRefresh?.id) {
    await c.query(
      `
      UPDATE collection_jobs
      SET status='pending', job_type='listing_refresh', job_config=$2,
          started_at=NULL, completed_at=NULL, error_message=NULL,
          crawl_state=NULL, updated_at=NOW()-interval '1 hour'
      WHERE id=$1
      `,
      [existingRefresh.id, cfg],
    );
    report.handedToRefresh.push({ id: existingRefresh.id, provider: name, action: "requeued_refresh" });
  } else {
    const ins = await c.query(
      `
      INSERT INTO collection_jobs (provider_id, job_type, status, job_config, created_at, updated_at)
      VALUES ($1, 'listing_refresh', 'pending', $2, NOW(), NOW()-interval '1 hour')
      RETURNING id
      `,
      [providerId, cfg],
    );
    report.handedToRefresh.push({ id: ins.rows[0].id, provider: name, action: "created_refresh" });
  }
}

const running = await c.query(`
  SELECT cj.id, p.internal_name, cj.job_type, cj.items_processed, cj.vins_new,
         ROUND(EXTRACT(EPOCH FROM (now()-cj.updated_at))/60.0,1) AS age_min
  FROM collection_jobs cj
  JOIN providers p ON p.id=cj.provider_id
  WHERE cj.status='running'
  ORDER BY p.internal_name
`);
report.running = running.rows;
report.pending = (
  await c.query(`SELECT count(*)::int AS n FROM collection_jobs WHERE status='pending'`)
).rows[0].n;

console.log(JSON.stringify(report, null, 2));
await c.end();
