import fs from "node:fs";
import pg from "pg";

const VIN = "W1NFD2DB6MA507466";
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
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const r = await c.query(
  `SELECT p.photo_group, count(*)::int n,
          count(*) FILTER (WHERE p.source_url ILIKE '%iaai%' OR p.source_url ILIKE '%mediaretriever%')::int iaa
   FROM photos p JOIN vehicles v ON v.id = p.vehicle_id
   WHERE v.vin = $1 GROUP BY 1 ORDER BY 1`,
  [VIN],
);
console.log(JSON.stringify(r.rows, null, 2));
await c.end();
