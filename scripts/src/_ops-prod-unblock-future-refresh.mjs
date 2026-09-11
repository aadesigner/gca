import fs from "node:fs";
import pg from "pg";
const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => (vars[n] && typeof vars[n]==="object" && "value" in vars[n] ? vars[n].value : vars[n]);
const url = `postgresql://${encodeURIComponent(get("PGUSER")||get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD")||get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE")||"railway"}`;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const u = await c.query(`
  UPDATE collection_jobs
  SET job_config = (
        COALESCE(job_config,'{}')::jsonb
        || jsonb_build_object(
             'nextRunAt', to_jsonb((NOW() - interval '1 minute')::text),
             'source', coalesce(job_config::jsonb->>'source','') || '+unblock_future'
           )
      )::text,
      updated_at = NOW() - interval '1 hour'
  WHERE status='pending'
    AND job_type='listing_refresh'
    AND job_config::jsonb ? 'nextRunAt'
    AND (job_config::jsonb->>'nextRunAt')::timestamptz > NOW()
  RETURNING id
`);
console.log("unblocked_future", u.rows);
await c.end();
