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
const s = await c.query(`SELECT status, items_discovered, items_processed, items_failed, pages_processed, round(extract(epoch from (NOW()-updated_at))/60)::int quiet_m, left(COALESCE(error_message,''),120) err FROM collection_jobs WHERE id=487`);
console.log("seobuk now", s.rows[0]);
const st = JSON.parse((await c.query(`SELECT crawl_state FROM collection_jobs WHERE id=487`)).rows[0].crawl_state || "{}");
console.log("seobuk shard", st.shards?.[0] && { status: st.shards[0].status, pages: st.shards[0].pagesProcessed, disc: st.shards[0].itemsDiscovered, fetched: st.shards[0].listingsFetched, err: st.shards[0].lastError, next: st.shards[0].nextPage });
const g = await c.query(`SELECT count(*) FILTER (WHERE last_seen_at>NOW()-interval '10 minutes')::int seen10 FROM listings WHERE provider_id=(SELECT id FROM providers WHERE internal_name='seobuk')`);
console.log("seobuk seen10m", g.rows[0]);
await c.end();
