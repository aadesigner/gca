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

const byGroup = await c.query(`
  SELECT photo_group, count(*)::bigint AS n
  FROM photos
  WHERE photo_group IN ('exterior_3d', 'interior_3d')
  GROUP BY 1 ORDER BY 1
`);

const byProvider = await c.query(`
  SELECT p.internal_name, ph.photo_group, count(*)::int AS n
  FROM photos ph
  JOIN listings l ON l.id = ph.listing_id
  JOIN providers p ON p.id = l.provider_id
  WHERE ph.photo_group IN ('exterior_3d', 'interior_3d')
  GROUP BY 1, 2
  ORDER BY n DESC
  LIMIT 15
`);

console.log(JSON.stringify({ byGroup: byGroup.rows, byProvider: byProvider.rows }, null, 2));
await c.end();
