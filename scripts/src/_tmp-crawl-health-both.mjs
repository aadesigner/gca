/**
 * Dual health: production (Railway TCP) + offline/local DATABASE_URL.
 */
import fs from "node:fs";
import pg from "pg";

function prodClient() {
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const v = j.variables || j;
  const g = (n) => (v[n] && typeof v[n] === "object" && "value" in v[n] ? v[n].value : v[n]);
  return new pg.Client({
    host: g("RAILWAY_TCP_PROXY_DOMAIN"),
    port: Number(g("RAILWAY_TCP_PROXY_PORT")),
    user: g("PGUSER") || g("POSTGRES_USER") || "postgres",
    password: g("PGPASSWORD") || g("POSTGRES_PASSWORD"),
    database: g("PGDATABASE") || "railway",
    ssl: { rejectUnauthorized: false },
  });
}

function localClient() {
  const url =
    process.env.DATABASE_URL ||
    "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";
  return new pg.Client({
    connectionString: url.includes("sslmode=") ? url : `${url}${url.includes("?") ? "&" : "?"}sslmode=disable`,
  });
}

async function snapshot(label, c) {
  const parallel = await c.query(`SELECT max_collection_jobs_parallel AS n FROM settings WHERE id=1`);
  const byStatus = await c.query(`
    SELECT status, count(*)::int AS n
    FROM collection_jobs
    WHERE status IN ('running','pending','paused')
    GROUP BY 1 ORDER BY 1
  `);
  const running = await c.query(`
    SELECT j.id, p.internal_name, j.job_type, j.status,
           j.listings_fetched, j.items_processed, j.vins_new,
           round(extract(epoch from (now()-j.updated_at))/60.0,1) AS quiet_m,
           left(coalesce(j.error_message,''),80) AS err,
           j.job_config::jsonb->>'detailLevel' AS detail
    FROM collection_jobs j
    JOIN providers p ON p.id=j.provider_id
    WHERE j.status='running'
    ORDER BY quiet_m DESC NULLS LAST
  `);
  const intake = await c.query(`
    SELECT
      (SELECT count(*)::int FROM listings WHERE created_at > now() - interval '15 minutes') AS listings_15m,
      (SELECT count(*)::int FROM listings WHERE created_at > now() - interval '2 minutes') AS listings_2m,
      (SELECT count(*)::int FROM photos WHERE created_at > now() - interval '15 minutes') AS photos_15m
  `);
  const quiet = running.rows.filter((r) => Number(r.quiet_m) >= 25);
  const encar = await c.query(`
    SELECT j.id, j.job_type, j.status, j.listings_fetched, j.items_processed, j.vins_new,
           round(extract(epoch from (now()-j.updated_at))/60.0,1) AS quiet_m,
           j.job_config::jsonb->>'detailLevel' AS detail,
           left(coalesce(j.error_message,''),100) AS err
    FROM collection_jobs j
    JOIN providers p ON p.id=j.provider_id
    WHERE p.internal_name='encar'
      AND j.status IN ('running','pending','paused','completed')
    ORDER BY
      CASE j.status WHEN 'running' THEN 0 WHEN 'pending' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
      j.id DESC
    LIMIT 6
  `);
  const offline = await c.query(`
    SELECT j.id, p.internal_name, j.job_type, j.status,
           j.listings_fetched, j.items_processed, j.vins_new,
           round(extract(epoch from (now()-j.updated_at))/60.0,1) AS quiet_m,
           left(coalesce(j.error_message,''),80) AS err
    FROM collection_jobs j
    JOIN providers p ON p.id=j.provider_id
    WHERE p.internal_name IN ('import_motor','autoplac','japanesecartrade')
      AND j.status IN ('running','pending','paused')
    ORDER BY p.internal_name, j.id DESC
  `);
  const deferredDue = await c.query(`
    SELECT count(*)::int AS n
    FROM collection_jobs
    WHERE status='pending'
      AND (
        job_config IS NULL
        OR job_config::jsonb->>'nextRunAt' IS NULL
        OR (job_config::jsonb->>'nextRunAt')::timestamptz <= now()
      )
  `);
  const activeGt2 = await c.query(`
    SELECT p.internal_name, count(*)::int AS active
    FROM collection_jobs j
    JOIN providers p ON p.id=j.provider_id
    WHERE j.status IN ('running','pending')
    GROUP BY 1
    HAVING count(*) > 2
    ORDER BY active DESC
    LIMIT 10
  `);

  console.log(`\n=== ${label} ===`);
  console.log("parallel", parallel.rows[0]?.n);
  console.log("by_status", byStatus.rows);
  console.log("intake_15m", intake.rows[0]);
  console.log("pending_due", deferredDue.rows[0]?.n);
  console.log("active_gt2", activeGt2.rows);
  console.log("running", running.rows);
  console.log("quiet_ge_25m", quiet);
  console.log("encar", encar.rows);
  console.log("offline_im_ap_jct", offline.rows);
}

const prod = prodClient();
await prod.connect();
await snapshot("PROD", prod);
await prod.end();

try {
  const local = localClient();
  await local.connect();
  await snapshot("OFFLINE/LOCAL", local);
  await local.end();
} catch (err) {
  console.log("\n=== OFFLINE/LOCAL ===");
  console.log("unavailable:", err instanceof Error ? err.message : String(err));
}
