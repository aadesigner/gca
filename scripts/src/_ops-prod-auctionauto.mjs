/**
 * AuctionAuto coverage on prod.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-auctionauto.mjs
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

const p = await c.query(`SELECT id, internal_name, name, enabled FROM providers WHERE internal_name ILIKE '%auction%auto%' OR internal_name ILIKE '%auctionauto%'`);
console.log("providers", p.rows);

for (const row of p.rows) {
  const stats = await c.query(
    `SELECT count(*)::int AS listings, count(DISTINCT vin)::int AS vins,
      count(*) FILTER (WHERE is_active)::int AS active,
      max(last_seen_at) AS newest, min(first_seen_at) AS oldest
     FROM listings WHERE provider_id=$1`,
    [row.id],
  );
  console.log("listings", stats.rows[0]);

  const jobs = await c.query(
    `SELECT id, job_type, status, started_at, completed_at, updated_at,
      listings_fetched, vins_found, vins_new, pages_processed, duplicates_skipped, items_failed,
      left(coalesce(error_message,''),200) AS err,
      left(coalesce(job_config,''),400) AS config
     FROM collection_jobs WHERE provider_id=$1 ORDER BY id DESC LIMIT 8`,
    [row.id],
  );
  console.log("jobs", JSON.stringify(jobs.rows, null, 2));

  const sample = await c.query(
    `SELECT id, vin, left(source_url,100) AS url, price_amount, mileage, first_seen_at, last_seen_at
     FROM listings WHERE provider_id=$1 ORDER BY id DESC LIMIT 8`,
    [row.id],
  );
  console.log("sample_listings", sample.rows);
}
await c.end();
