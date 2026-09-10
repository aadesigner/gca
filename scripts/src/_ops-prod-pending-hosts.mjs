import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => {
    const v = vars[n];
    return v && typeof v === "object" && "value" in v ? v.value : v;
  };
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const c = new pg.Client({
  connectionString: loadProdUrl(),
  ssl: { rejectUnauthorized: false },
  statement_timeout: 120000,
});
await c.connect();
const hosts = await c.query(`
  SELECT lower(substring(source_url from 'https?://([^/]+)')) AS host, count(*)::int AS n
  FROM photos
  WHERE stored_path IS NULL
  GROUP BY 1
  ORDER BY n DESC
  LIMIT 15
`);
console.log(JSON.stringify(hosts.rows, null, 2));
await c.end();
