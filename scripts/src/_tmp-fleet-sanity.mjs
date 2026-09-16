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
const r = await c.query(
  `SELECT status, count(*)::int n FROM collection_jobs WHERE status IN ('running','pending','paused') GROUP BY 1 ORDER BY 1`,
);
const e = await c.query(
  `SELECT id,status,listings_fetched,items_processed,vins_new, round(extract(epoch from (now()-updated_at))/60.0,1) quiet_m FROM collection_jobs WHERE id=376`,
);
const due = await c.query(
  `SELECT count(*)::int AS n FROM collection_jobs j WHERE status='pending' AND (job_config IS NULL OR job_config::jsonb->>'nextRunAt' IS NULL OR (job_config::jsonb->>'nextRunAt')::timestamptz <= now())`,
);
console.log({ by_status: r.rows, encar: e.rows[0], pending_due: due.rows[0] });
await c.end();
