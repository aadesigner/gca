import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const c = new pg.Client({ connectionString: loadProdUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`
SELECT now() AS db_now,
  (SELECT count(*)::int FROM listings WHERE created_at > now() - interval '30 minutes') AS listings_30m,
  (SELECT count(*)::int FROM listings WHERE created_at > now() - interval '10 minutes') AS listings_10m,
  (SELECT max(updated_at) FROM collection_jobs WHERE status='running') AS max_job_upd,
  (SELECT max(created_at) FROM listings) AS newest_listing
`);
console.log(JSON.stringify(r.rows[0], null, 2));
const j = await c.query(`
SELECT cj.id, p.internal_name, cj.status,
  ROUND(EXTRACT(EPOCH FROM (now()-cj.updated_at))/60.0,1) AS age_min,
  cj.items_processed, cj.vins_new, cj.pages_processed, cj.updated_at
FROM collection_jobs cj
JOIN providers p ON p.id=cj.provider_id
WHERE cj.status='running'
ORDER BY cj.updated_at ASC
`);
console.log(JSON.stringify(j.rows, null, 2));
await c.end();
