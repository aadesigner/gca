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

const providers = await c.query(`
  SELECT internal_name, enabled, left(COALESCE(notes,''),120) notes
  FROM providers
  WHERE internal_name = ANY($1::text[])
  ORDER BY 1
`, [["finn","seobuk","koreaauto_auction","carpoolkr"]]);
console.log("=== providers ===");
console.log(providers.rows);

const jobs = await c.query(`
  SELECT p.internal_name, j.id, j.status, j.job_type,
         j.items_discovered, j.items_processed, j.items_failed, j.vins_new, j.pages_processed,
         round(extract(epoch from (NOW()-j.updated_at))/60)::int AS quiet_m,
         left(COALESCE(j.error_message,''),160) err,
         j.updated_at
  FROM collection_jobs j
  JOIN providers p ON p.id=j.provider_id
  WHERE p.internal_name = ANY($1::text[])
    AND j.updated_at > NOW() - interval '6 hours'
  ORDER BY p.internal_name, j.updated_at DESC
`, [["finn","seobuk","koreaauto_auction","carpoolkr"]]);
console.log("=== jobs 6h ===");
console.log(jobs.rows);

const growth = await c.query(`
  SELECT p.internal_name,
    count(*) FILTER (WHERE l.first_seen_at > NOW() - interval '1 hour')::int AS new_1h,
    count(*) FILTER (WHERE l.last_seen_at > NOW() - interval '1 hour')::int AS seen_1h,
    count(*) FILTER (WHERE l.first_seen_at > NOW() - interval '24 hours')::int AS new_24h,
    count(*)::int AS total_listings
  FROM providers p
  LEFT JOIN listings l ON l.provider_id=p.id
  WHERE p.internal_name = ANY($1::text[])
  GROUP BY 1 ORDER BY 1
`, [["finn","seobuk","koreaauto_auction","carpoolkr"]]);
console.log("=== listing growth ===");
console.log(growth.rows);

const running = await c.query(`
  SELECT count(*) FILTER (WHERE status='running')::int AS running,
         count(*) FILTER (WHERE status='pending')::int AS pending
  FROM collection_jobs WHERE status IN ('running','pending')
`);
console.log("=== fleet slots ===", running.rows[0]);

await c.end();
