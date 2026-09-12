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

const samples = await c.query(`
SELECT ve.event_type, left(ve.description,180) AS description, ve.occurred_at::date AS day,
  left(ve.metadata::text,240) AS meta, v.vin
FROM vehicle_events ve
JOIN vehicles v ON v.id = ve.vehicle_id
WHERE EXISTS (
  SELECT 1 FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE l.vehicle_id = v.id AND p.internal_name = 'encar'
)
AND (
  ve.description ILIKE '%none none%'
  OR ve.description ILIKE '%overall none%'
  OR ve.description ILIKE '%Performance inspection%'
  OR ve.description ILIKE '%Inspection panel%'
  OR ve.description ILIKE '%없음%'
)
ORDER BY ve.id DESC
LIMIT 30
`);
console.log(JSON.stringify(samples.rows, null, 2));

const types = await c.query(`
SELECT ve.event_type, count(*)::int AS n,
  count(*) FILTER (WHERE ve.description ILIKE '%none%')::int AS noneish
FROM vehicle_events ve
WHERE EXISTS (
  SELECT 1 FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE l.vehicle_id = ve.vehicle_id AND p.internal_name = 'encar'
)
GROUP BY 1
ORDER BY n DESC
`);
console.log("types", types.rows);
await c.end();
