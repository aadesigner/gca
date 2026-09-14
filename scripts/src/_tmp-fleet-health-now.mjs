import fs from "node:fs";
import pg from "pg";
const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => { const v = vars[n]; return v && typeof v === "object" && "value" in v ? v.value : v; };
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const fleet = await c.query(`
  SELECT count(*) FILTER (WHERE status='running')::int AS running,
         count(*) FILTER (WHERE status='pending')::int AS pending,
         count(*) FILTER (WHERE status='running' AND updated_at < NOW()-interval '20 minutes')::int AS quiet_20m,
         count(*) FILTER (WHERE status='running' AND updated_at < NOW()-interval '45 minutes')::int AS quiet_45m
  FROM collection_jobs WHERE status IN ('running','pending')
`);
console.log("fleet", fleet.rows[0]);

const running = await c.query(`
  SELECT p.internal_name, j.id, j.job_type,
         COALESCE(j.items_discovered,0)::int disc,
         COALESCE(j.items_processed,0)::int proc,
         COALESCE(j.items_failed,0)::int fail,
         COALESCE(j.vins_new,0)::int vins_new,
         round(extract(epoch from (NOW()-j.updated_at))/60)::int quiet_m,
         left(COALESCE(j.error_message,''),100) err
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE j.status='running'
  ORDER BY j.updated_at ASC
`);
console.log("running", running.rows);

const growth = await c.query(`
  SELECT p.internal_name,
    count(*) FILTER (WHERE l.first_seen_at > NOW()-interval '1 hour')::int new_1h,
    count(*) FILTER (WHERE l.last_seen_at > NOW()-interval '1 hour')::int seen_1h
  FROM providers p
  JOIN collection_jobs j ON j.provider_id=p.id AND j.status='running'
  LEFT JOIN listings l ON l.provider_id=p.id
  GROUP BY p.internal_name
  ORDER BY seen_1h DESC NULLS LAST, p.internal_name
`);
console.log("growthRunningProviders", growth.rows);

const focus = await c.query(`
  SELECT p.internal_name, p.enabled, j.id, j.status,
         COALESCE(j.items_processed,0)::int proc,
         COALESCE(j.items_failed,0)::int fail,
         COALESCE(j.vins_new,0)::int vins_new,
         round(extract(epoch from (NOW()-j.updated_at))/60)::int quiet_m
  FROM providers p
  LEFT JOIN LATERAL (
    SELECT * FROM collection_jobs cj
    WHERE cj.provider_id=p.id AND cj.status IN ('running','pending')
    ORDER BY CASE cj.status WHEN 'running' THEN 0 ELSE 1 END, cj.updated_at DESC
    LIMIT 1
  ) j ON true
  WHERE p.internal_name = ANY($1::text[])
  ORDER BY 1
`, [["finn","seobuk","koreaauto_auction","copart","import_motor","autowini","encar"]]);

console.log("focus", focus.rows);

const badFail = running.rows.filter(r => r.proc > 0 && r.fail > r.proc * 2 && r.fail > 50);
const quiet = running.rows.filter(r => r.quiet_m >= 20);
console.log("alerts", { quietStuck: quiet.map(r=>({name:r.internal_name,id:r.id,quiet_m:r.quiet_m,proc:r.proc})), highFail: badFail.map(r=>({name:r.internal_name,id:r.id,proc:r.proc,fail:r.fail})) });

await c.end();
