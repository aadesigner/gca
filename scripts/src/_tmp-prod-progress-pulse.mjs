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

const a = await c.query(`
  SELECT j.id, p.internal_name, j.listings_fetched, j.items_processed, j.vins_new,
         round(extract(epoch from (now()-j.updated_at))/60.0,1) AS quiet_m,
         j.crawl_state::jsonb->>'currentShardId' AS shard,
         j.crawl_state::jsonb->>'strategy' AS strategy
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE j.id IN (376,322,473,328,406,451) ORDER BY j.id
`);
console.log("t0", a.rows);
await new Promise((r) => setTimeout(r, 20000));
const b = await c.query(`
  SELECT j.id, p.internal_name, j.listings_fetched, j.items_processed, j.vins_new,
         round(extract(epoch from (now()-j.updated_at))/60.0,1) AS quiet_m,
         j.crawl_state::jsonb->>'currentShardId' AS shard
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE j.id IN (376,322,473,328,406,451) ORDER BY j.id
`);
console.log("t20s", b.rows);
await c.end();
