/** Pause every production collection job. No crawl on prod. */
import fs from "node:fs";
import pg from "pg";

function loadProd() {
  if (process.env.PROD_DATABASE_URL) {
    return new pg.Client({
      connectionString: process.env.PROD_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return new pg.Client({
    host: process.env.PROD_PG_HOST ?? get("RAILWAY_TCP_PROXY_DOMAIN"),
    port: Number(process.env.PROD_PG_PORT ?? get("RAILWAY_TCP_PROXY_PORT") ?? 5432),
    user: process.env.PROD_PG_USER ?? get("PGUSER") ?? get("POSTGRES_USER") ?? "postgres",
    password: process.env.PROD_PG_PASSWORD ?? get("PGPASSWORD") ?? get("POSTGRES_PASSWORD"),
    database: process.env.PROD_PG_DATABASE ?? get("PGDATABASE") ?? "railway",
    ssl: false,
  });
}

const c = loadProd();
await c.connect();
const r = await c.query(`
  UPDATE collection_jobs
  SET status = 'paused',
      error_message = 'paused — no production crawl',
      job_config = (
        jsonb_set(
          COALESCE(NULLIF(job_config, '')::jsonb, '{}'::jsonb),
          '{pausedForMirrorDrain}',
          'true'::jsonb
        )
      )::text,
      updated_at = now()
  WHERE status IN ('running', 'pending')
  RETURNING id
`);
console.log({ paused: r.rows.map((x) => x.id), n: r.rowCount });
await c.end();
