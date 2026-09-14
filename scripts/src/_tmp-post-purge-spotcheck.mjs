import fs from "node:fs";
import pg from "pg";
const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => { const v = vars[n]; return v && typeof v === "object" && "value" in v ? v.value : v; };
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const vins = ["3C4NJCBB3LT170041","JTHD51FF7L5012169","WP0AB2A92TS227786","WP1AB2A53HLB11672"];
const r = await c.query(`
  SELECT v.vin,
    count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
    count(*) FILTER (WHERE p.photo_group='exterior_3d')::int ext,
    count(*) FILTER (WHERE p.photo_group='interior_3d')::int int
  FROM vehicles v LEFT JOIN photos p ON p.vehicle_id=v.id
  WHERE v.vin = ANY($1::text[])
  GROUP BY v.vin ORDER BY v.vin
`, [vins]);
console.log(r.rows);
await c.end();
