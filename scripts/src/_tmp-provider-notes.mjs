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
  SELECT internal_name, enabled, left(notes,160) AS notes
  FROM providers
  WHERE internal_name IN ('mobilede','willhaben','finn','koreaauto_auction','carpoolkr','seobuk','koreausedcars')
  ORDER BY internal_name
`);
console.log(JSON.stringify(r.rows, null, 2));
await c.end();
