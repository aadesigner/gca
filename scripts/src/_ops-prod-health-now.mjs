import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => {
    const v = vars[n];
    return v && typeof v === "object" && "value" in v ? v.value : v;
  };
  const user = get("PGUSER") || get("POSTGRES_USER");
  const pass = get("PGPASSWORD") || get("POSTGRES_PASSWORD");
  const db = get("PGDATABASE") || get("POSTGRES_DB") || "railway";
  const host = get("RAILWAY_TCP_PROXY_DOMAIN");
  const port = get("RAILWAY_TCP_PROXY_PORT");
  if (!host || !port) throw new Error("missing proxy");
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}`;
}

const c = new pg.Client({
  connectionString: loadProdUrl(),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 25000,
  statement_timeout: 120000,
});
await c.connect();

const settings = await c.query(`
  SELECT max_collection_jobs_parallel FROM settings WHERE id=1
`);

const running = await c.query(`
  SELECT cj.id, p.internal_name, cj.job_type, cj.status,
         cj.pages_processed, cj.listings_fetched, cj.vins_new, cj.items_processed,
         ROUND(EXTRACT(EPOCH FROM (now()-cj.updated_at))/60.0,1) AS age_min,
         left(cj.error_message,80) AS err
  FROM collection_jobs cj
  JOIN providers p ON p.id=cj.provider_id
  WHERE cj.status='running'
  ORDER BY cj.updated_at ASC
`);

const pendingN = await c.query(`
  SELECT count(*)::int AS n FROM collection_jobs WHERE status='pending'
`);

const stale = running.rows.filter((r) => Number(r.age_min) >= 90);

const today = await c.query(`
  SELECT count(*)::int AS listings_utc_day,
         count(DISTINCT vehicle_id)::int AS vehicles_utc_day
  FROM listings
  WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
`);

const last2h = await c.query(`
  SELECT count(*)::int AS listings_2h
  FROM listings WHERE created_at > now() - interval '2 hours'
`);

const mirror = await c.query(`
  SELECT count(*) FILTER (WHERE stored_path IS NULL)::bigint AS pending,
         count(*) FILTER (WHERE stored_path ~* 'imgsv')::bigint AS cdn,
         count(*) FILTER (WHERE stored_path LIKE 'mirror-failed:%')::bigint AS failed_marked
  FROM photos
`);

const jct = await c.query(`
  SELECT cj.id, cj.status, cj.pages_processed, cj.listings_fetched, cj.vins_new, cj.updated_at,
         left(cj.error_message,100) AS err
  FROM collection_jobs cj
  JOIN providers p ON p.id=cj.provider_id
  WHERE p.internal_name='japanesecartrade'
  ORDER BY cj.id DESC LIMIT 3
`);

console.log(JSON.stringify({
  parallelCap: settings.rows[0],
  runningCount: running.rows.length,
  pendingJobs: pendingN.rows[0].n,
  staleRunningGt90m: stale.length,
  running: running.rows,
  intake: { ...today.rows[0], ...last2h.rows[0] },
  photos: mirror.rows[0],
  jct: jct.rows,
}, null, 2));

await c.end();
