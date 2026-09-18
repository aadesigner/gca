import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
const raw = fs.readFileSync(path.join(os.tmpdir(), "gca-pg-vars-prod.json"), "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const v = j.variables || j;
const g = (n) => v[n]?.value ?? v[n];
const c = new pg.Client({
  host: g("RAILWAY_TCP_PROXY_DOMAIN") || "yamanote.proxy.rlwy.net",
  port: Number(g("RAILWAY_TCP_PROXY_PORT") || 15622),
  user: g("PGUSER") || "postgres",
  password: g("PGPASSWORD") || g("POSTGRES_PASSWORD"),
  database: g("PGDATABASE") || "railway",
  ssl: false,
});
await c.connect();
const r = await c.query(`
  SELECT id, status, items_processed, pages_processed,
    job_config::jsonb->>'detailLevel' AS d, updated_at::text
  FROM collection_jobs WHERE id = 552
`);
console.log(r.rows[0]);
await c.end();
