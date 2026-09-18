/**
 * Hard-restart Encar full: cancel running #376 so the worker drops it,
 * then queue a fresh full_collection with detailLevel=full + cleared state.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

function loadProd() {
  const p = path.join(os.tmpdir(), "gca-pg-vars-prod.json");
  const raw = fs.readFileSync(p, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) =>
    vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n];
  return {
    host: get("RAILWAY_TCP_PROXY_DOMAIN") || "yamanote.proxy.rlwy.net",
    port: Number(get("RAILWAY_TCP_PROXY_PORT") || 15622),
    user: get("PGUSER") || get("POSTGRES_USER") || "postgres",
    password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
    database: get("PGDATABASE") || "railway",
    ssl: false,
  };
}

const c = new pg.Client(loadProd());
await c.connect();

const { rows: prov } = await c.query(`SELECT id FROM providers WHERE internal_name = 'encar'`);
const encarId = prov[0].id;

const cancelled = await c.query(
  `
  UPDATE collection_jobs cj
  SET status = 'cancelled',
      completed_at = COALESCE(completed_at, now()),
      error_message = 'ops: hard restart Encar full_collection',
      updated_at = now()
  FROM providers pr
  WHERE pr.id = cj.provider_id
    AND pr.internal_name IN ('encar', 'ams')
    AND cj.status IN ('pending', 'running', 'paused')
  RETURNING cj.id, cj.job_type, cj.status
`,
);
console.log("cancelled", cancelled.rows);

// Brief pause so worker notices cancelled before we insert pending
await new Promise((r) => setTimeout(r, 4000));

const cfg = JSON.stringify({
  detailLevel: "full",
  delayMs: 500,
  concurrency: 3,
  retryCount: 3,
  skipRecentHours: 0,
  maxPages: 0,
  maxListings: 0,
  resetCrawlState: true,
  nextRunAt: new Date().toISOString(),
});

const created = await c.query(
  `
  INSERT INTO collection_jobs (provider_id, job_type, status, job_config)
  VALUES ($1, 'full_collection', 'pending', $2)
  RETURNING id, status, job_type, job_config::jsonb ->> 'detailLevel' AS detail_level
`,
  [encarId, cfg],
);
console.log("created", created.rows);

const active = await c.query(`
  SELECT cj.id, pr.internal_name, cj.job_type, cj.status,
    cj.job_config::jsonb ->> 'detailLevel' AS detail_level,
    cj.items_processed, (cj.crawl_state IS NOT NULL) AS has_state
  FROM collection_jobs cj
  JOIN providers pr ON pr.id = cj.provider_id
  WHERE pr.internal_name IN ('encar', 'ams')
    AND cj.status IN ('pending', 'running', 'paused')
  ORDER BY cj.id DESC
`);
console.log("active", active.rows);

await c.end();
