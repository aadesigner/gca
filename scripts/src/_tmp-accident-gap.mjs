import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => {
  const v = vars[n];
  return v && typeof v === "object" && "value" in v ? v.value : v;
};
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// Sample Encar accidents with cost metadata
const encar = await c.query(`
  SELECT v.vin, ve.description, ve.metadata, ve.occurred_at, p.internal_name
  FROM vehicle_events ve
  JOIN vehicles v ON v.id = ve.vehicle_id
  JOIN listings l ON l.vehicle_id = v.id
  JOIN providers p ON p.id = l.provider_id
  WHERE ve.event_type = 'accident'
    AND p.internal_name = 'encar'
    AND ve.metadata ILIKE '%partCost%'
  ORDER BY ve.occurred_at DESC NULLS LAST
  LIMIT 5
`);

// Sample IM Korean accidents (thin?)
const im = await c.query(`
  SELECT v.vin, ve.description, ve.metadata, ve.occurred_at, p.internal_name
  FROM vehicle_events ve
  JOIN vehicles v ON v.id = ve.vehicle_id
  JOIN listings l ON l.vehicle_id = v.id
  JOIN providers p ON p.id = l.provider_id
  WHERE ve.event_type = 'accident'
    AND p.internal_name = 'import_motor'
  ORDER BY ve.occurred_at DESC NULLS LAST
  LIMIT 5
`);

const counts = await c.query(`
  SELECT p.internal_name,
         count(*)::int AS accident_events,
         count(*) FILTER (WHERE ve.metadata ILIKE '%partCost%')::int AS with_part_cost,
         count(*) FILTER (WHERE ve.metadata ILIKE '%insuranceBenefit%')::int AS with_benefit
  FROM vehicle_events ve
  JOIN listings l ON l.vehicle_id = ve.vehicle_id
  JOIN providers p ON p.id = l.provider_id
  WHERE ve.event_type = 'accident'
    AND p.internal_name IN ('encar','import_motor','kbchachacha','autowini')
  GROUP BY 1
`);

console.log(JSON.stringify({ counts: counts.rows, encarSamples: encar.rows, imSamples: im.rows }, null, 2));
await c.end();
