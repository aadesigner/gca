/**
 * Soft-unstick quiet running jobs (preserve crawl_state) — same idea as runner watchdog.
 */
import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const v = j.variables || j;
const g = (n) => (v[n] && typeof v[n] === "object" && "value" in v[n] ? v[n].value : v[n]);
const c = new pg.Client({
  host: g("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(g("RAILWAY_TCP_PROXY_PORT")),
  user: g("PGUSER") || "postgres",
  password: g("PGPASSWORD"),
  database: g("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const quietIds = [376, 322, 328, 473];
const dueNow = new Date(Date.now() - 60_000).toISOString();

for (let i = 0; i < quietIds.length; i++) {
  const id = quietIds[i];
  const stagger = new Date(Date.now() - 60_000 + i * 15_000).toISOString();
  const r = await c.query(
    `
    UPDATE collection_jobs
    SET status = 'pending',
        error_message = 'post-deploy quiet unstick',
        completed_at = NULL,
        job_config = (COALESCE(job_config::jsonb, '{}'::jsonb) || jsonb_build_object('nextRunAt', $2::text))::text,
        updated_at = NOW()
    WHERE id = $1 AND status = 'running'
      AND updated_at < NOW() - interval '8 minutes'
    RETURNING id, status
    `,
    [id, stagger],
  );
  console.log("unstick", id, r.rows);
}

await new Promise((r) => setTimeout(r, 18000));

const after = await c.query(`
  SELECT j.id, p.internal_name, j.status, j.listings_fetched, j.items_processed,
         round(extract(epoch from (now()-j.updated_at))/60.0,1) AS quiet_m,
         left(coalesce(j.error_message,''),60) AS err
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE j.id IN (376,322,328,473,406,451) OR j.status='running'
  ORDER BY j.status, j.id
`);
console.log("after", after.rows);

const intake = await c.query(`
  SELECT
    (SELECT count(*)::int FROM listings WHERE created_at > now() - interval '5 minutes') AS listings_5m,
    (SELECT count(*)::int FROM listings WHERE created_at > now() - interval '2 minutes') AS listings_2m
`);
console.log("intake", intake.rows[0]);
await c.end();
