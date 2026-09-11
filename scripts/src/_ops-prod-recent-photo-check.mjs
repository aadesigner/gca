import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
const url = `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const recent = await c.query(`
  SELECT p.internal_name, v.vin, l.country,
    (SELECT count(*)::int FROM photos x WHERE x.listing_id=l.id) AS photos,
    (SELECT count(*)::int FROM photos x WHERE x.listing_id=l.id AND x.stored_path ~* 'imgsv') AS cdn,
    (SELECT count(*)::int FROM photos x WHERE x.listing_id=l.id AND x.stored_path IS NULL) AS pending
  FROM listings l
  JOIN providers p ON p.id=l.provider_id
  JOIN vehicles v ON v.id=l.vehicle_id
  WHERE p.internal_name IN ('autoplac','import_motor')
  ORDER BY l.id DESC
  LIMIT 12
`);
console.log(recent.rows);

const auto = await c.query(`
  SELECT count(*)::int AS photos,
    count(*) FILTER (WHERE stored_path ~* 'imgsv')::int AS cdn,
    count(*) FILTER (WHERE stored_path IS NULL)::int AS pending
  FROM photos ph JOIN listings l ON l.id=ph.listing_id JOIN providers p ON p.id=l.provider_id
  WHERE p.internal_name='autoplac'
`);
console.log("autoplac", auto.rows[0]);
await c.end();
