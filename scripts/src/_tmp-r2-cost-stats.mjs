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
  user: get("PGUSER") || get("POSTGRES_USER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || get("POSTGRES_DB") || "railway",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 25000,
});
await c.connect();
await c.query("SET statement_timeout='120s'");

const totals = await c.query(`
  SELECT
    count(*)::bigint AS total_photos,
    count(*) FILTER (WHERE stored_path IS NOT NULL AND stored_path NOT LIKE 'mirror-failed:%')::bigint AS mirrored,
    count(*) FILTER (WHERE stored_path IS NULL)::bigint AS pending,
    count(*) FILTER (WHERE stored_path LIKE 'mirror-failed:%')::bigint AS failed,
    count(*) FILTER (WHERE stored_path ILIKE '%imgsv.getcarapi.com%' OR stored_path ILIKE '%r2.dev%')::bigint AS on_cdn_url,
    count(*) FILTER (WHERE created_at > NOW() - interval '24 hours')::bigint AS created_24h,
    count(*) FILTER (WHERE created_at > NOW() - interval '7 days')::bigint AS created_7d,
    count(*) FILTER (
      WHERE stored_path IS NOT NULL
        AND stored_path NOT LIKE 'mirror-failed:%'
        AND updated_at > NOW() - interval '24 hours'
    )::bigint AS mirror_touch_24h
`);

console.log(JSON.stringify(totals.rows[0], null, 2));
await c.end();
