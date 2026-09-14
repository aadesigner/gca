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

const finn = await c.query(`
  SELECT id, status, items_discovered, items_processed, items_failed, vins_new, pages_processed,
         round(extract(epoch from (NOW()-updated_at))/60)::int quiet_m,
         left(COALESCE(error_message,''),160) err,
         updated_at
  FROM collection_jobs WHERE id=486 OR (provider_id=(SELECT id FROM providers WHERE internal_name='finn') AND updated_at>NOW()-interval '2 hours')
  ORDER BY updated_at DESC LIMIT 5
`);
console.log("finn jobs", finn.rows);

const g = await c.query(`
  SELECT p.internal_name,
    count(*) FILTER (WHERE l.first_seen_at > NOW() - interval '30 minutes')::int AS new_30m,
    count(*) FILTER (WHERE l.last_seen_at > NOW() - interval '30 minutes')::int AS seen_30m,
    count(*) FILTER (WHERE l.first_seen_at > NOW() - interval '2 hours')::int AS new_2h
  FROM providers p
  LEFT JOIN listings l ON l.provider_id=p.id
  WHERE p.internal_name = ANY($1::text[])
  GROUP BY 1 ORDER BY 1
`, [["finn","seobuk","koreaauto_auction"]]);
console.log("growth", g.rows);

// Did a new Finn job start after deploy?
const recent = await c.query(`
  SELECT p.internal_name, j.id, j.status, j.items_processed, j.items_failed, j.vins_new,
         j.started_at, j.updated_at, left(COALESCE(j.job_config,''),200) cfg
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE p.internal_name IN ('finn','seobuk','koreaauto_auction')
  ORDER BY j.updated_at DESC LIMIT 8
`);
console.log("recent", recent.rows);

await c.end();
