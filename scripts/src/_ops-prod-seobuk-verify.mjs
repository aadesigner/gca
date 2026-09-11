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
  SELECT l.title, v.make, v.model, v.trim, v.engine_displacement
  FROM listings l
  JOIN providers p ON p.id=l.provider_id
  JOIN vehicles v ON v.id=l.vehicle_id
  WHERE p.internal_name='seobuk'
    AND l.source_url LIKE '%C69157DC50E8F44D36FA762D7CD64D47%'
`);
console.log("was_null_example", r.rows);

const stats = await c.query(`
  SELECT count(*)::int AS n,
    count(*) FILTER (WHERE v.trim IS NULL OR trim(v.trim)='')::int AS no_trim,
    count(*) FILTER (WHERE v.model ~* '\\([A-Z][0-9]{2}')::int AS model_has_chassis_paren,
    count(*) FILTER (WHERE v.model ~* '\\b(W|C|V|X|A)[0-9]{3}\\b' OR v.model ~* '\\([A-Z][0-9]{2}')::int AS model_has_gen
  FROM listings l JOIN providers p ON p.id=l.provider_id JOIN vehicles v ON v.id=l.vehicle_id
  WHERE p.internal_name='seobuk'
`);
console.log("stats", stats.rows[0]);
await c.end();
