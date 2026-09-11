/**
 * Encar coverage snapshot on prod.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-encar-coverage.mjs
 */
import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const c = new pg.Client({ connectionString: loadProdUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();

const providers = await c.query(`
  SELECT id, internal_name, name, enabled
  FROM providers WHERE internal_name ILIKE '%encar%'
`);
console.log("providers", providers.rows);

for (const p of providers.rows) {
  const stats = await c.query(
    `
    SELECT count(*)::int AS listings,
      count(*) FILTER (WHERE is_active)::int AS active,
      count(DISTINCT vin)::int AS vins,
      min(first_seen_at) AS oldest,
      max(last_seen_at) AS newest
    FROM listings WHERE provider_id = $1
    `,
    [p.id],
  );
  console.log(p.internal_name, stats.rows[0]);

  const jobs = await c.query(
    `
    SELECT id, job_type, status,
      progress_current, progress_total, last_run_at, next_run_at,
      left(coalesce(error_message,''), 160) AS err,
      left(coalesce(config::text,''), 500) AS config,
      left(coalesce(crawl_state::text,''), 400) AS crawl_state
    FROM collection_jobs
    WHERE provider_id = $1
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT 8
    `,
    [p.id],
  );
  console.log("jobs", JSON.stringify(jobs.rows, null, 2));
}
await c.end();
