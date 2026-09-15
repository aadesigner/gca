import fs from "node:fs";
import pg from "pg";
import { createRequire } from "node:module";

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
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const cols = await c.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'raw_source_records' ORDER BY ordinal_position
`);
console.log(cols.rows.map((r) => r.column_name));

for (const sid of ["476506249", "476506345", "476506378"]) {
  const r = await c.query(
    `SELECT id, listing_id, provider_id, source_url, created_at,
            length(coalesce(body::text, payload::text, content::text, html::text, '')) as body_len
     FROM raw_source_records
     WHERE source_url ILIKE '%' || $1 || '%'
        OR (metadata::text ILIKE '%' || $1 || '%')
     ORDER BY id DESC LIMIT 3`,
    [sid],
  ).catch(async (e) => {
    console.log("queryFail", e.message);
    // introspect and retry simpler
    return c.query(
      `SELECT * FROM raw_source_records WHERE source_url ILIKE '%' || $1 || '%' ORDER BY id DESC LIMIT 1`,
      [sid],
    );
  });
  console.log(sid, "raw", r.rows.map((row) => ({ id: row.id, listing_id: row.listing_id, created_at: row.created_at, keys: Object.keys(row) })));
}

// collection job logs around that time
const jobs = await c.query(`
  SELECT id, provider_id, status, created_at, updated_at, error, progress
  FROM collection_jobs
  WHERE created_at > now() - interval '6 hours'
  ORDER BY id DESC LIMIT 15
`).catch((e) => ({ rows: [{ err: e.message }] }));
console.log("recentJobs", jobs.rows);

await c.end();
