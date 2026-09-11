import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
const url = `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const jobs = await c.query(`
  SELECT id, job_type, status, started_at, completed_at, updated_at,
    job_config, crawl_state,
    listings_fetched, vins_found, vins_new, pages_processed,
    left(coalesce(error_message,''), 160) AS err
  FROM collection_jobs
  WHERE provider_id = 1
  ORDER BY id DESC
  LIMIT 12
`);
for (const row of jobs.rows) {
  let config = row.job_config;
  let cs = row.crawl_state;
  try {
    if (typeof config === "string") config = JSON.parse(config);
  } catch {
    /* keep */
  }
  try {
    if (typeof cs === "string") cs = JSON.parse(cs);
  } catch {
    /* keep */
  }
  console.log("---", row.id, row.job_type, row.status);
  console.log("times", { started: row.started_at, completed: row.completed_at, updated: row.updated_at });
  console.log("counters", {
    pages: row.pages_processed,
    fetched: row.listings_fetched,
    vins: row.vins_found,
    newVins: row.vins_new,
  });
  console.log("config", JSON.stringify(config)?.slice(0, 500));
  if (cs && typeof cs === "object") {
    console.log("crawl", {
      mode: cs.mode,
      page: cs.page,
      year: cs.year ?? cs.current?.year,
      make: cs.make ?? cs.current?.make,
      carType: cs.carType ?? cs.filters?.carType ?? config?.carType ?? config?.filters?.carType,
      queueLen: Array.isArray(cs.queue) ? cs.queue.length : Array.isArray(cs.shards) ? cs.shards.length : undefined,
      keys: Object.keys(cs).slice(0, 20),
    });
  }
  if (row.err) console.log("err", row.err);
}
await c.end();
