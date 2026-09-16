import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) =>
  vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n];

const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const deferUntil = new Date(Date.now() + 45 * 60_000).toISOString();

const r = await c.query(
  `
  UPDATE collection_jobs
  SET status = 'pending',
      error_message = NULL,
      job_config = (COALESCE(job_config::jsonb, '{}'::jsonb) || jsonb_build_object('nextRunAt', $1::text))::text,
      updated_at = NOW()
  WHERE id IN (226, 322) AND status = 'paused'
  RETURNING id, status, job_config::jsonb->>'nextRunAt' AS next_run
  `,
  [deferUntil],
);
console.log("requeued_paused", r.rows);

const encar = await c.query(`
  SELECT id, status, pages_processed, listings_fetched, items_processed, vins_new,
         round(extract(epoch from (now()-updated_at))/60.0,1) AS quiet_m,
         job_config::jsonb->>'detailLevel' AS detail
  FROM collection_jobs WHERE id = 376
`);
console.log("encar", encar.rows[0]);

await c.end();
