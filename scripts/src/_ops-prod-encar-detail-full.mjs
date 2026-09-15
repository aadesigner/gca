/**
 * Force prod Encar (+ AMS) jobs to detailLevel=full so diagnosis/inspection
 * (body diagram marks) are fetched on new/refresh crawls.
 *
 * Usage: node scripts/src/_ops-prod-encar-detail-full.mjs
 */
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
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const before = await c.query(`
  SELECT cj.id, pr.internal_name, cj.job_type, cj.status,
         cj.job_config::jsonb ->> 'detailLevel' AS detail_level
  FROM collection_jobs cj
  JOIN providers pr ON pr.id = cj.provider_id
  WHERE pr.internal_name IN ('encar', 'ams')
    AND cj.status IN ('pending', 'running', 'paused', 'failed', 'completed')
  ORDER BY cj.id DESC
  LIMIT 40
`);
console.log("before", before.rows);

const updated = await c.query(`
  UPDATE collection_jobs cj
  SET
    job_config = jsonb_set(
      COALESCE(cj.job_config::jsonb, '{}'::jsonb),
      '{detailLevel}',
      '"full"'::jsonb,
      true
    )::text,
    updated_at = now()
  FROM providers pr
  WHERE pr.id = cj.provider_id
    AND pr.internal_name IN ('encar', 'ams')
    AND cj.status IN ('pending', 'running', 'paused', 'failed')
  RETURNING cj.id, pr.internal_name, cj.job_type, cj.status,
            (cj.job_config::jsonb ->> 'detailLevel') AS detail_level
`);
console.log("updated", updated.rowCount, updated.rows);

// Also bump completed jobs that are the latest refresh/full for encar so next resume is full
const completed = await c.query(`
  UPDATE collection_jobs cj
  SET
    job_config = jsonb_set(
      COALESCE(cj.job_config::jsonb, '{}'::jsonb),
      '{detailLevel}',
      '"full"'::jsonb,
      true
    )::text,
    updated_at = now()
  FROM providers pr
  WHERE pr.id = cj.provider_id
    AND pr.internal_name IN ('encar', 'ams')
    AND cj.status = 'completed'
    AND cj.id IN (
      SELECT DISTINCT ON (cj2.provider_id, cj2.job_type) cj2.id
      FROM collection_jobs cj2
      JOIN providers pr2 ON pr2.id = cj2.provider_id
      WHERE pr2.internal_name IN ('encar', 'ams')
        AND cj2.status = 'completed'
      ORDER BY cj2.provider_id, cj2.job_type, cj2.id DESC
    )
  RETURNING cj.id, pr.internal_name, cj.job_type, cj.status,
            (cj.job_config::jsonb ->> 'detailLevel') AS detail_level
`);
console.log("completedPatched", completed.rowCount, completed.rows);

const after = await c.query(`
  SELECT cj.id, pr.internal_name, cj.job_type, cj.status,
         cj.job_config::jsonb ->> 'detailLevel' AS detail_level
  FROM collection_jobs cj
  JOIN providers pr ON pr.id = cj.provider_id
  WHERE pr.internal_name IN ('encar', 'ams')
    AND cj.status IN ('pending', 'running', 'paused', 'failed')
  ORDER BY cj.id DESC
`);
console.log("activeAfter", after.rows);

await c.end();
console.log("Done. Restart/redeploy API workers so in-memory job config reloads.");
