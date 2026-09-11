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
  SELECT l.title, v.make, v.model, v.trim, v.engine_displacement, v.year, left(l.source_url,100) AS url
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE p.internal_name = 'seobuk'
    AND (
      l.title ILIKE '%528%'
      OR l.title ILIKE '%F10%'
      OR l.title ILIKE '%320i%'
      OR l.title ~ '[0-9]{3}[iIdDxXsS]'
    )
  ORDER BY l.id DESC
  LIMIT 20
`);
console.log(JSON.stringify(r.rows, null, 2));

const blank = await c.query(`
  SELECT count(*)::int AS n,
    count(*) FILTER (WHERE v.trim IS NULL OR trim(v.trim)='')::int AS no_trim,
    count(*) FILTER (WHERE v.engine_displacement IS NULL OR trim(v.engine_displacement)='')::int AS no_engine
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE p.internal_name = 'seobuk'
`);
console.log("stats", blank.rows[0]);

const samples = await c.query(`
  SELECT left(l.title,120) AS title, v.make, v.model, v.trim, v.engine_displacement
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE p.internal_name = 'seobuk'
  ORDER BY l.id DESC
  LIMIT 12
`);
console.log("recent", samples.rows);
await c.end();
