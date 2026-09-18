/**
 * Hold prod AP/NFS/AA full jobs until adapters are deployed.
 *   node --import ./load-env.mjs ./src/_ops-hold-ap-nfs-aa-prod.mjs
 * Clear hold after deploy:
 *   CLEAR=1 node --import ./load-env.mjs ./src/_ops-hold-ap-nfs-aa-prod.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

function loadProd() {
  if (process.env.PROD_DATABASE_URL) {
    return { connectionString: process.env.PROD_DATABASE_URL, ssl: { rejectUnauthorized: false } };
  }
  const p = path.join(os.tmpdir(), "gca-pg-vars-prod.json");
  const raw = fs.readFileSync(p, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) =>
    vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n];
  return {
    host: get("RAILWAY_TCP_PROXY_DOMAIN") || process.env.PROD_PG_HOST,
    port: Number(get("RAILWAY_TCP_PROXY_PORT") || process.env.PROD_PG_PORT || 5432),
    user: get("PGUSER") || get("POSTGRES_USER") || process.env.PROD_PG_USER || "postgres",
    password: get("PGPASSWORD") || get("POSTGRES_PASSWORD") || process.env.PROD_PG_PASSWORD,
    database: get("PGDATABASE") || process.env.PROD_PG_DATABASE || "railway",
    ssl: false,
  };
}

const clear = process.env.CLEAR === "1";
const c = new pg.Client(loadProd());
await c.connect();

if (clear) {
  const next = new Date(Date.now() - 60_000).toISOString();
  const r = await c.query(
    `
    UPDATE collection_jobs cj
    SET job_config = (
          (COALESCE(cj.job_config::jsonb,'{}'::jsonb) - 'awaitingDeploy')
          || jsonb_build_object('nextRunAt', $1::text)
        )::text,
        error_message = NULL,
        status = 'pending',
        updated_at = now() - interval '2 hours',
        created_at = least(created_at, now() - interval '2 days')
    FROM providers p
    WHERE p.id = cj.provider_id
      AND p.internal_name = ANY(ARRAY['auctionauto','autopartner','nfsauto'])
      AND cj.job_type IN ('full_collection', 'listing_refresh')
      AND (
        cj.status = 'pending'
        OR (cj.status IN ('cancelled','failed') AND cj.updated_at > now() - interval '14 days')
      )
    RETURNING cj.id, p.internal_name, cj.job_type, cj.status, cj.job_config::jsonb->>'nextRunAt' AS next
    `,
    [next],
  );
  // Ensure at least one pending full + refresh per provider so fleet picks them up post-deploy.
  for (const name of ["auctionauto", "autopartner", "nfsauto"]) {
    const prov = await c.query(`SELECT id FROM providers WHERE internal_name = $1`, [name]);
    const pid = prov.rows[0]?.id;
    if (!pid) continue;
    for (const jobType of ["full_collection", "listing_refresh"]) {
      const exists = await c.query(
        `SELECT id FROM collection_jobs WHERE provider_id = $1 AND job_type = $2 AND status = 'pending' LIMIT 1`,
        [pid, jobType],
      );
      if (exists.rows.length) continue;
      await c.query(
        `
        INSERT INTO collection_jobs (provider_id, job_type, status, job_config, created_at, updated_at)
        VALUES (
          $1, $2, 'pending',
          $3::text,
          now() - interval '2 days',
          now() - interval '2 hours'
        )
        `,
        [
          pid,
          jobType,
          JSON.stringify({
            nextRunAt: next,
            parserVersion: name === "nfsauto" ? "nfsauto-v1.2.0" : name === "autopartner" ? "autopartner-v1.1.0" : undefined,
            reason: "post-deploy-english-usd-dates",
          }),
        ],
      );
    }
  }
  console.log(JSON.stringify({ cleared: r.rows, note: "full+refresh pending ensured" }, null, 2));
} else {
  const next = new Date(Date.now() + 36 * 3600_000).toISOString();
  const r = await c.query(
    `
    UPDATE collection_jobs cj
    SET job_config = (
          COALESCE(cj.job_config::jsonb,'{}'::jsonb)
          || jsonb_build_object('nextRunAt', $1::text, 'awaitingDeploy', true)
        )::text,
        error_message = 'awaiting deploy: autopartner/nfsauto/auctionauto adapters',
        updated_at = now()
    FROM providers p
    WHERE p.id = cj.provider_id
      AND p.internal_name = ANY(ARRAY['auctionauto','autopartner','nfsauto'])
      AND cj.status = 'pending'
      AND cj.job_type = 'full_collection'
    RETURNING cj.id, p.internal_name, cj.job_config::jsonb->>'nextRunAt' AS next
    `,
    [next],
  );
  console.log(JSON.stringify({ held: r.rows }, null, 2));
}

await c.end();
