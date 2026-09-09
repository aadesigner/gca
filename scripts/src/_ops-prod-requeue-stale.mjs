import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
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
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}`;
}

const dry = process.argv.includes("--dry");
const c = new pg.Client({
  connectionString: process.env.PROD_DATABASE_URL || loadProdUrl(),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});
await c.connect();

const running = await c.query(`
  SELECT cj.id, p.internal_name, cj.job_type, cj.status, cj.updated_at,
         ROUND(EXTRACT(EPOCH FROM (now() - cj.updated_at))/3600.0, 2) AS hours_stale,
         cj.vins_new, cj.items_processed, cj.pages_processed
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE cj.status = 'running'
  ORDER BY cj.updated_at ASC
`);
console.log("RUNNING", JSON.stringify(running.rows, null, 2));

const stale = running.rows.filter((r) => Number(r.hours_stale) >= 2);
console.log("STALE_COUNT", stale.length, "ids", stale.map((r) => r.id));

if (!dry && stale.length) {
  const ids = stale.map((r) => r.id);
  const upd = await c.query(
    `UPDATE collection_jobs
     SET status = 'pending',
         error_message = COALESCE(error_message, '') || CASE WHEN error_message IS NULL OR error_message = '' THEN '' ELSE '; ' END || 'ops: requeued after stale running >2h',
         completed_at = NULL,
         updated_at = NOW()
     WHERE id = ANY($1::int[])
     RETURNING id, status`,
    [ids],
  );
  console.log("REQUEUED", upd.rows);
}

const counts = await c.query(`
  SELECT status, count(*)::int AS n
  FROM collection_jobs
  WHERE status IN ('running','pending')
  GROUP BY 1
`);
console.log("STATUS_COUNTS", counts.rows);

await c.end();
