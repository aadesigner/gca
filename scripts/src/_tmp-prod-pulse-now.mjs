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
  password: get("PGPASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const pulse = await c.query(`
  SELECT p.internal_name,
         count(*) FILTER (WHERE l.created_at > now() - interval '15 minutes')::int AS l15,
         count(*) FILTER (WHERE l.created_at > now() - interval '1 hour')::int AS l1h
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE l.created_at > now() - interval '1 hour'
  GROUP BY 1
  ORDER BY l15 DESC, l1h DESC
  LIMIT 15
`);

const quiet = await c.query(`
  SELECT cj.id, p.internal_name, cj.status,
         ROUND(EXTRACT(EPOCH FROM (now()-cj.updated_at))/60.0,1) AS age_min,
         cj.items_processed, cj.listings_fetched
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE cj.status = 'running'
    AND cj.updated_at < now() - interval '20 minutes'
  ORDER BY cj.updated_at ASC
`);

console.log(JSON.stringify({ pulse: pulse.rows, quietRunning: quiet.rows }, null, 2));
await c.end();
