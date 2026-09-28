import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) =>
  vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n];

const c = new pg.Client({
  host: process.env.PROD_PG_HOST ?? get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(process.env.PROD_PG_PORT ?? get("RAILWAY_TCP_PROXY_PORT") ?? 5432),
  user: process.env.PROD_PG_USER ?? get("PGUSER") ?? "postgres",
  password: process.env.PROD_PG_PASSWORD ?? get("PGPASSWORD") ?? get("POSTGRES_PASSWORD"),
  database: process.env.PROD_PG_DATABASE ?? get("PGDATABASE") ?? "railway",
  ssl: false,
});

await c.connect();

const jobs = await c.query(`
  SELECT j.id, p.internal_name, j.job_type, j.status, j.pages_processed, j.vins_found,
         left(coalesce(j.error_message,''), 100) AS err,
         left(j.job_config::text, 220) AS cfg,
         j.updated_at
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE p.internal_name = 'encar'
     OR j.status IN ('running', 'pending')
  ORDER BY j.updated_at DESC NULLS LAST
  LIMIT 20
`);
console.log("JOBS", JSON.stringify(jobs.rows, null, 2));

const photos = await c.query(`
  SELECT count(*)::int AS photos,
         count(*) FILTER (WHERE stored_path IS NOT NULL AND btrim(stored_path) <> '')::int AS mirrored,
         count(*) FILTER (WHERE stored_path IS NULL OR btrim(stored_path) = '')::int AS source_only
  FROM photos
`);
console.log("PHOTOS", photos.rows[0]);

const pending = await c.query(`
  SELECT count(*)::int AS pending_mirror
  FROM photos
  WHERE (stored_path IS NULL OR btrim(stored_path) = '')
    AND source_url IS NOT NULL
    AND btrim(source_url) <> ''
`);
console.log("PENDING_MIRROR", pending.rows[0]);

const recent = await c.query(`
  SELECT date_trunc('day', created_at) AS day, count(*)::int AS n
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'encar'
    AND l.created_at > now() - interval '14 days'
  GROUP BY 1
  ORDER BY 1 DESC
`);
console.log("ENCAR_LISTINGS_14D", recent.rows);

await c.end();
