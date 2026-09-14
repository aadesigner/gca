/**
 * Unstick quiet fleet + force Finn / Seobuk / KAA to the front of the queue.
 */
import fs from "node:fs";
import pg from "pg";

const QUIET_MIN = Number(process.env.QUIET_MIN || 12);
const PRIORITY = ["finn", "seobuk", "koreaauto_auction"];

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
  connectionTimeoutMillis: 25000,
});
await c.connect();

await c.query(`UPDATE settings SET max_collection_jobs_parallel = 8, updated_at = NOW() WHERE id = 1`);

// Requeue quiet runners
const quiet = await c.query(
  `
  UPDATE collection_jobs j
  SET status = 'pending',
      started_at = NULL,
      completed_at = NULL,
      error_message = 'ops: unstick quiet runner (new-providers check)',
      job_config = (
        jsonb_set(
          COALESCE(NULLIF(j.job_config, '')::jsonb, '{}'::jsonb),
          '{nextRunAt}',
          to_jsonb(to_char(NOW() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        )
      )::text,
      updated_at = NOW()
  WHERE j.status = 'running'
    AND j.updated_at < NOW() - ($1 || ' minutes')::interval
  RETURNING j.id, (SELECT internal_name FROM providers p WHERE p.id = j.provider_id) AS name,
            round(extract(epoch from (NOW() - j.updated_at))/60)::int AS was_quiet_m
  `,
  [String(QUIET_MIN)],
);
console.log("requeuedQuiet", quiet.rows);

// Ensure one pending full_collection for each priority provider, due NOW, oldest created_at so they claim next
for (const name of PRIORITY) {
  const prov = await c.query(`SELECT id, enabled FROM providers WHERE internal_name=$1`, [name]);
  if (!prov.rows[0]) continue;
  if (!prov.rows[0].enabled) {
    await c.query(`UPDATE providers SET enabled=true, updated_at=NOW() WHERE id=$1`, [prov.rows[0].id]);
  }
  const pid = prov.rows[0].id;

  // Cancel extras / zombies for this provider
  await c.query(
    `
    UPDATE collection_jobs
    SET status='cancelled', completed_at=COALESCE(completed_at,NOW()), updated_at=NOW(),
        error_message=COALESCE(error_message,'superseded — priority kick')
    WHERE provider_id=$1 AND status IN ('running','pending','paused')
    `,
    [pid],
  );

  const cfg = JSON.stringify({
    nextRunAt: new Date().toISOString(),
    repeatHours: name === "koreaauto_auction" ? 6 : 5,
    source: "ops-priority-kick-new-providers",
    detailLevel: "full",
    concurrency: 2,
    delayMs: name === "finn" ? 1000 : name === "seobuk" ? 800 : 500,
    skipRecentHours: 0,
  });

  const ins = await c.query(
    `
    INSERT INTO collection_jobs (provider_id, job_type, status, job_config, created_at, updated_at)
    VALUES ($1, 'full_collection', 'pending', $2, NOW() - interval '2 days', NOW())
    RETURNING id
    `,
    [pid, cfg],
  );
  console.log("queued", name, ins.rows[0].id);
}

const snap = await c.query(`
  SELECT p.internal_name, j.id, j.status, j.job_type, j.items_processed,
         round(extract(epoch from (NOW()-j.updated_at))/60)::int AS quiet_m
  FROM collection_jobs j
  JOIN providers p ON p.id=j.provider_id
  WHERE j.status IN ('running','pending')
  ORDER BY CASE j.status WHEN 'running' THEN 0 ELSE 1 END, j.created_at ASC
  LIMIT 20
`);
console.log("queueHead", snap.rows);
await c.end();
