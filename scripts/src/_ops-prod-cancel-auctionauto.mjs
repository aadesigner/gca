/**
 * Cancel wasteful AuctionAuto full crawl on prod (Korea-first, ~0 VIN yield).
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-cancel-auctionauto.mjs
 */
import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const c = new pg.Client({ connectionString: loadProdUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();

const r = await c.query(`
  UPDATE collection_jobs cj
  SET status = 'cancelled',
      completed_at = COALESCE(completed_at, NOW()),
      updated_at = NOW(),
      error_message = left(COALESCE(error_message,'') || ' | cancelled: korea-first burn (~0 VIN); prefer USA-first / fleet-skip', 500)
  FROM providers p
  WHERE p.id = cj.provider_id
    AND p.internal_name = 'auctionauto'
    AND cj.status IN ('running', 'pending')
  RETURNING cj.id, cj.job_type, cj.status, cj.listings_fetched, cj.vins_found, cj.vins_new
`);
console.log("cancelled", r.rows);
await c.end();
