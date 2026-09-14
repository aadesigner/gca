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

// Any system events / recent errors mentioning finn
const se = await c.query(`
  SELECT left(COALESCE(event_type, type, ''),80) t, left(COALESCE(message, details::text, ''),200) m, created_at
  FROM system_events
  WHERE created_at > NOW()-interval '2 hours'
    AND (COALESCE(message,'') ILIKE '%finn%' OR COALESCE(details::text,'') ILIKE '%finn%' OR COALESCE(event_type,'') ILIKE '%finn%')
  ORDER BY created_at DESC LIMIT 20
`).catch(async (e) => {
  const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='system_events'`);
  return { rows: [], err: e.message, cols: cols.rows.map(r=>r.column_name) };
});
console.log("system_events", se);

// job_logs any for 486 with occurred_at
const jl = await c.query(`SELECT count(*)::int n, min(occurred_at) mn, max(occurred_at) mx FROM job_logs WHERE job_id=486`);
console.log("job_logs486", jl.rows[0]);

// sample recent finn raw errors from job if crawl_state has lastError
const cs = await c.query(`SELECT left(crawl_state, 1500) FROM collection_jobs WHERE id=486`);
const st = JSON.parse(cs.rows[0].left || cs.rows[0]["?column?"] || "{}");
console.log("crawl keys", Object.keys(st));
console.log("lastBlock", st.lastBlock);
console.log("lastHealth", st.lastHealthSnapshot);
if (st.shards) console.log("shards", st.shards.map(s=>({id:s.id,status:s.status,err:s.lastError,fetched:s.listingsFetched,pages:s.pagesProcessed})));

await c.end();
