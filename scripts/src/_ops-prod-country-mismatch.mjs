import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
const url = `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const prov = await c.query(`
  SELECT p.country AS provider_country, count(l.id)::int AS listings
  FROM providers p LEFT JOIN listings l ON l.provider_id=p.id
  GROUP BY p.country ORDER BY listings DESC LIMIT 10
`);
console.log("dashboard_style_provider_country", prov.rows);

const veh = await c.query(`
  SELECT coalesce(nullif(trim(country),''),'Unknown') AS c, count(*)::int AS n
  FROM vehicles GROUP BY 1 ORDER BY n DESC LIMIT 15
`);
console.log("vehicles_country", veh.rows);

const list = await c.query(`
  SELECT coalesce(nullif(trim(country),''),'Unknown') AS c, count(*)::int AS n
  FROM listings GROUP BY 1 ORDER BY n DESC LIMIT 15
`);
console.log("listings_country", list.rows);

const mismatch = await c.query(`
  SELECT p.internal_name, p.country AS prov,
    count(*) FILTER (WHERE coalesce(v.country,'') NOT IN ('South Korea','Korea','KR') )::int AS non_kr_veh,
    count(*)::int AS total
  FROM listings l
  JOIN providers p ON p.id=l.provider_id
  JOIN vehicles v ON v.id=l.vehicle_id
  WHERE p.country IN ('KR','Korea','South Korea')
  GROUP BY p.internal_name, p.country
  ORDER BY non_kr_veh DESC
  LIMIT 12
`);
console.log("kr_provider_non_kr_vehicles", mismatch.rows);
await c.end();
