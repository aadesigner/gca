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

const r = await c.query(`
  SELECT v.vin,
         count(*) FILTER (WHERE ph.photo_group = 'exterior_3d')::int AS exterior_3d,
         count(*) FILTER (WHERE ph.photo_group = 'interior_3d')::int AS interior_3d,
         max(p.internal_name) AS provider,
         max(ph.source_url) FILTER (WHERE ph.photo_group = 'exterior_3d') AS sample_ext_url
  FROM photos ph
  JOIN vehicles v ON v.id = ph.vehicle_id
  LEFT JOIN listings l ON l.id = ph.listing_id
  LEFT JOIN providers p ON p.id = l.provider_id
  WHERE ph.photo_group IN ('exterior_3d', 'interior_3d')
  GROUP BY v.vin
  HAVING count(*) FILTER (WHERE ph.photo_group = 'exterior_3d') >= 20
  ORDER BY count(*) FILTER (WHERE ph.photo_group = 'exterior_3d') DESC,
           count(*) FILTER (WHERE ph.photo_group = 'interior_3d') DESC
  LIMIT 8
`);
console.log(JSON.stringify(r.rows, null, 2));
await c.end();
