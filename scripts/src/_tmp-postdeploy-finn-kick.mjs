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

// Cancel poisoned Finn jobs (0 processed / huge fails)
const cancelled = await c.query(`
  UPDATE collection_jobs j
  SET status='cancelled', completed_at=COALESCE(completed_at,NOW()), updated_at=NOW(),
      error_message='ops: cancel poisoned Finn after deploy — restart clean'
  FROM providers p
  WHERE j.provider_id=p.id AND p.internal_name='finn'
    AND j.status IN ('running','pending','paused')
  RETURNING j.id, j.items_failed, j.items_processed
`);
console.log("cancelledFinn", cancelled.rows);

// Free 2 low-progress runners so Finn can claim
const freed = await c.query(`
  UPDATE collection_jobs j
  SET status='pending', started_at=NULL, completed_at=NULL, updated_at=NOW(),
      error_message='ops: yield slot for Finn postdeploy',
      job_config = (
        jsonb_set(
          COALESCE(NULLIF(j.job_config,'')::jsonb, '{}'::jsonb),
          '{nextRunAt}',
          to_jsonb(to_char((NOW()+interval '20 minutes') AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        )
      )::text
  WHERE j.id IN (
    SELECT j2.id FROM collection_jobs j2
    JOIN providers p2 ON p2.id=j2.provider_id
    WHERE j2.status='running'
      AND p2.internal_name <> ALL(ARRAY['finn','seobuk','koreaauto_auction','import_motor','copart'])
      AND COALESCE(j2.items_processed,0) < 100
    ORDER BY COALESCE(j2.items_processed,0) ASC, j2.updated_at ASC
    LIMIT 2
  )
  RETURNING j.id
`);
console.log("freed", freed.rows);

const pid = (await c.query(`SELECT id FROM providers WHERE internal_name='finn'`)).rows[0].id;
const cfg = JSON.stringify({
  source: "ops-postdeploy-finn-fresh",
  delayMs: 1000,
  concurrency: 2,
  detailLevel: "full",
  repeatHours: 5,
  skipRecentHours: 0,
  resetCrawlState: true,
  nextRunAt: new Date().toISOString(),
});
const ins = await c.query(`
  INSERT INTO collection_jobs (provider_id, job_type, status, job_config, created_at, updated_at)
  VALUES ($1, 'full_collection', 'pending', $2, TIMESTAMP '2019-01-01', NOW())
  RETURNING id
`, [pid, cfg]);
console.log("queuedFreshFinn", ins.rows[0].id);

// Also bump Seobuk/KAA pending to front if any
await c.query(`
  UPDATE collection_jobs j
  SET created_at = TIMESTAMP '2019-01-01',
      updated_at = NOW(),
      job_config = jsonb_set(
        COALESCE(NULLIF(j.job_config,'')::jsonb, '{}'::jsonb),
        '{nextRunAt}',
        to_jsonb(to_char(NOW() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      )::text
  FROM providers p
  WHERE j.provider_id=p.id AND j.status='pending'
    AND p.internal_name = ANY(ARRAY['finn','seobuk','koreaauto_auction'])
`);

await c.end();
console.log("waiting 50s for claim...");
