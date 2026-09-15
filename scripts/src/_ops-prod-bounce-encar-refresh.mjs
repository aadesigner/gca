/**
 * Bounce running Encar refresh so it reloads detailLevel=full from job_config.
 */
import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => {
  const v = vars[n];
  return v && typeof v === "object" && "value" in v ? v.value : v;
};

const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const r = await c.query(`
  UPDATE collection_jobs cj
  SET status = 'pending',
      started_at = NULL,
      error_message = NULL,
      completed_at = NULL,
      updated_at = now()
  FROM providers pr
  WHERE pr.id = cj.provider_id
    AND pr.internal_name IN ('encar', 'ams')
    AND cj.status = 'running'
    AND cj.job_type = 'listing_refresh'
  RETURNING cj.id, cj.job_type, cj.status,
            (cj.job_config::jsonb ->> 'detailLevel') AS detail_level
`);
console.log("bounced", r.rows);
await c.end();
