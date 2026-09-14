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

const sample = await c.query(`
  SELECT p.internal_name, ph.photo_group, left(ph.source_url, 100) AS url
  FROM photos ph
  JOIN listings l ON l.id = ph.listing_id
  JOIN providers p ON p.id = l.provider_id
  WHERE ph.photo_group IN ('exterior_3d', 'interior_3d')
    AND p.internal_name IN ('copart', 'iaa', 'import_motor')
  ORDER BY random()
  LIMIT 8
`);
console.log(JSON.stringify(sample.rows, null, 2));
await c.end();
