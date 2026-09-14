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

const logs = await c.query(`
  SELECT jl.level, jl.stage, left(jl.message, 240) msg, jl.occurred_at,
         left(COALESCE(jl.details::text,''), 300) details
  FROM job_logs jl
  WHERE jl.job_id = 486
  ORDER BY jl.occurred_at DESC
  LIMIT 30
`);
console.log("=== finn recent logs ===");
for (const r of logs.rows) console.log(JSON.stringify(r));

const errSample = await c.query(`
  SELECT level, count(*)::int n, left(message, 180) msg
  FROM job_logs
  WHERE job_id = 486 AND level IN ('error','warn')
  GROUP BY 1, 3
  ORDER BY n DESC
  LIMIT 15
`);
console.log("=== finn error groups ===");
console.log(errSample.rows);

// KAA listings actually written?
const kaa = await c.query(`
  SELECT count(*)::int n,
    count(*) FILTER (WHERE vin IS NOT NULL AND length(vin)>=11)::int with_vin,
    max(last_seen_at) last_seen
  FROM listings WHERE provider_id=(SELECT id FROM providers WHERE internal_name='koreaauto_auction')
    AND last_seen_at > NOW()-interval '2 hours'
`);
console.log("=== kaa recent listings ===", kaa.rows[0]);

await c.end();
