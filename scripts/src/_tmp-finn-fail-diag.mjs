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

const cols = await c.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='job_logs' ORDER BY 1
`);
console.log("job_logs cols", cols.rows.map((r) => r.column_name));

const logs = await c.query(`
  SELECT jl.level, left(jl.message, 220) msg, jl.created_at
  FROM job_logs jl
  WHERE jl.job_id = ANY($1::int[])
  ORDER BY jl.created_at DESC
  LIMIT 40
`, [[486, 487, 488]]).catch((e) => ({ rows: [], err: e.message }));
console.log("logs", logs.err || logs.rows);

const jobs = await c.query(`
  SELECT p.internal_name, j.id, j.status, j.items_processed, j.items_failed, j.items_discovered,
         left(COALESCE(j.error_message,''),200) err,
         left(COALESCE(j.job_config,''),250) cfg
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE j.id = ANY($1::int[])
`, [[486, 487, 488]]);
console.log("jobs", jobs.rows);

// growth last 30m
const g = await c.query(`
  SELECT p.internal_name,
    count(*) FILTER (WHERE l.first_seen_at > NOW() - interval '30 minutes')::int AS new_30m,
    count(*) FILTER (WHERE l.last_seen_at > NOW() - interval '30 minutes')::int AS seen_30m
  FROM providers p
  LEFT JOIN listings l ON l.provider_id=p.id
  WHERE p.internal_name = ANY($1::text[])
  GROUP BY 1 ORDER BY 1
`, [["finn","seobuk","koreaauto_auction"]]);
console.log("growth30m", g.rows);

await c.end();
