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

const cancel = await c.query(`
  UPDATE collection_jobs
  SET status = 'cancelled',
      completed_at = COALESCE(completed_at, NOW()),
      error_message = 'free slot for encar full'
  WHERE id = 491 AND status = 'running'
  RETURNING id, status
`);
console.log("cancel_finn_dup", cancel.rows);

await new Promise((r) => setTimeout(r, 12_000));

const s = await c.query(`
  SELECT j.id, p.internal_name, j.job_type, j.status,
         j.listings_fetched, j.items_processed,
         length(coalesce(j.crawl_state::text,'')) AS crawl_len,
         round(extract(epoch from (now()-j.updated_at))/60.0,1) AS quiet_m
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.id = 376 OR j.status = 'running'
  ORDER BY j.status, j.id
`);
console.log(s.rows);
await c.end();
