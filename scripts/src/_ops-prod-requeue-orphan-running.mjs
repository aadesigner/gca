/**
 * Requeue production jobs stuck in running with no heartbeat (post-deploy orphans).
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-requeue-orphan-running.mjs
 *   MIN_AGE_MIN=5 DRY_RUN=1 ...
 */
import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const dry = process.env.DRY_RUN === "1";
const minAge = Number(process.env.MIN_AGE_MIN || 5);

const c = new pg.Client({ connectionString: loadProdUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();

const stale = await c.query(
  `
  SELECT cj.id, p.internal_name, cj.job_type,
    ROUND(EXTRACT(EPOCH FROM (now()-cj.updated_at))/60.0,1) AS age_min,
    cj.items_processed, cj.vins_new
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE cj.status = 'running'
    AND cj.updated_at < now() - ($1::text || ' minutes')::interval
  ORDER BY cj.updated_at ASC
  `,
  [String(minAge)],
);

console.log(JSON.stringify({ dry, minAge, count: stale.rows.length, rows: stale.rows }, null, 2));

if (!dry && stale.rows.length) {
  const ids = stale.rows.map((r) => r.id);
  const upd = await c.query(
    `
    UPDATE collection_jobs
    SET status = 'pending',
        completed_at = NULL,
        error_message = CASE
          WHEN error_message IS NULL OR error_message = '' THEN 'ops: requeued orphan running after deploy'
          ELSE error_message || '; ops: requeued orphan running after deploy'
        END,
        updated_at = now()
    WHERE id = ANY($1::int[]) AND status = 'running'
    RETURNING id, status
    `,
    [ids],
  );
  console.log("REQUEUED", upd.rows);
}

const counts = await c.query(`
  SELECT status, count(*)::int AS n FROM collection_jobs
  WHERE status IN ('running','pending') GROUP BY 1 ORDER BY 1
`);
console.log("STATUS", counts.rows);
await c.end();
