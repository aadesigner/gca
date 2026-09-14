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
const row = (await c.query(`SELECT crawl_state, items_failed, items_processed, items_discovered, pages_processed, status, updated_at FROM collection_jobs WHERE id=486`)).rows[0];
const st = JSON.parse(row.crawl_state);
const sh = st.shards?.[0];
console.log(JSON.stringify({
  status: row.status,
  failed: row.items_failed,
  processed: row.items_processed,
  discovered: row.items_discovered,
  pages: row.pages_processed,
  updated: row.updated_at,
  shard: sh && { id: sh.id, status: sh.status, nextPage: sh.nextPage, pages: sh.pagesProcessed, discovered: sh.itemsDiscovered, fetched: sh.listingsFetched, lastError: sh.lastError },
  lastBlock: st.lastBlock,
}, null, 2));

const se = await c.query(`
  SELECT event_type, severity, left(message,200) message, occurred_at
  FROM system_events
  WHERE job_id=486 OR (provider_id=(SELECT id FROM providers WHERE internal_name='finn') AND occurred_at>NOW()-interval '2 hours')
  ORDER BY occurred_at DESC LIMIT 15
`);
console.log("events", se.rows);

const kaa = await c.query(`SELECT crawl_state, items_failed, items_processed, items_discovered, pages_processed, status FROM collection_jobs WHERE id=488`);
const kst = JSON.parse(kaa.rows[0].crawl_state);
console.log("kaa", { status: kaa.rows[0].status, proc: kaa.rows[0].items_processed, fail: kaa.rows[0].items_failed, disc: kaa.rows[0].items_discovered, shard: kst.shards?.[0] && { fetched: kst.shards[0].listingsFetched, pages: kst.shards[0].pagesProcessed, next: kst.shards[0].nextPage, err: kst.shards[0].lastError }});

const seo = await c.query(`SELECT id, status, created_at, updated_at, left(COALESCE(error_message,''),120) err FROM collection_jobs WHERE id=487`);
console.log("seobuk", seo.rows[0]);

await c.end();
