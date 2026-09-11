import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
const url = `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const r = await c.query(`
  SELECT ph.id, ph.listing_id, ph.vehicle_id, ph.is_primary, ph.sort_order,
    left(ph.source_url,90) AS src,
    left(coalesce(ph.stored_path,''),60) AS stored
  FROM photos ph
  JOIN listings l ON l.id = ph.listing_id
  WHERE l.id = 1116346
  ORDER BY ph.sort_order, ph.id
`);
console.log(r.rows);

const topPending = await c.query(`
  SELECT ph.listing_id, count(*)::int AS n, max(ph.listing_id) AS max_l
  FROM photos ph
  WHERE ph.stored_path IS NULL AND ph.source_url ILIKE '%import-motor.com%'
  GROUP BY ph.listing_id
  ORDER BY ph.listing_id DESC NULLS LAST
  LIMIT 5
`);
console.log("top_pending_listings", topPending.rows);
await c.end();
