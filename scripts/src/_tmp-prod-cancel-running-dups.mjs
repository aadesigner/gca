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
  user: get("PGUSER") || get("POSTGRES_USER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || get("POSTGRES_DB") || "railway",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 25000,
});
await c.connect();

const r = await c.query(`
  UPDATE collection_jobs pend
  SET status = 'cancelled',
      completed_at = NOW(),
      updated_at = NOW(),
      error_message = 'ops: cancel pending — provider already running'
  FROM collection_jobs run
  WHERE pend.status = 'pending'
    AND run.status = 'running'
    AND pend.provider_id = run.provider_id
    AND pend.id <> run.id
  RETURNING pend.id,
    (SELECT internal_name FROM providers p WHERE p.id = pend.provider_id) AS name
`);
console.log(JSON.stringify({ cancelled: r.rows }, null, 2));
await c.end();
