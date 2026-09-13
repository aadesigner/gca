import pg from "pg";
import fs from "fs";

const local = new pg.Client({ connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable" });
await local.connect();

const live = await local.query(`
  SELECT cj.id, p.internal_name, cj.job_type, cj.status, cj.pages_processed, cj.items_processed, cj.vins_new,
         cj.error_message, cj.updated_at,
         left(coalesce(cj.job_config,''), 180) AS cfg
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE cj.status IN ('running','pending')
  ORDER BY p.internal_name, cj.id
`);
console.log("=== LOCAL LIVE ===");
for (const r of live.rows) console.log(JSON.stringify(r));

const carpool = await local.query(`
  SELECT cj.id, p.internal_name, cj.job_type, cj.status, cj.pages_processed, cj.items_processed, cj.vins_new,
         cj.error_message, cj.updated_at, cj.completed_at, cj.job_config
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE p.internal_name ILIKE '%carpool%' OR p.internal_name ILIKE '%korea%'
  ORDER BY cj.updated_at DESC
  LIMIT 15
`);
console.log("\n=== LOCAL CARPOOL/KOREA JOBS ===");
for (const r of carpool.rows) console.log(JSON.stringify({
  id:r.id, name:r.internal_name, type:r.job_type, status:r.status,
  pages:r.pages_processed, items:r.items_processed, new:r.vins_new,
  err:r.error_message, updated:r.updated_at, completed:r.completed_at,
  cfg: String(r.job_config||"").slice(0,220)
}));

const listings = await local.query(`
  SELECT p.internal_name, count(*)::int AS n, max(l.created_at) AS newest
  FROM listings l JOIN providers p ON p.id=l.provider_id
  WHERE p.internal_name ILIKE '%carpool%'
  GROUP BY 1
`);
console.log("\ncarpool listings", listings.rows);

await local.end();
