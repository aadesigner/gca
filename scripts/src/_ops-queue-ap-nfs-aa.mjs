/**
 * Seed + queue full_collection for Auto Partner, NFS Auto, Auction Auto
 * on local and/or prod. Always starts full; listing_refresh follows via worker.
 *
 *   node --import ./load-env.mjs ./src/_ops-queue-ap-nfs-aa.mjs
 *   TARGET=prod node --import ./load-env.mjs ./src/_ops-queue-ap-nfs-aa.mjs
 *   TARGET=both node --import ./load-env.mjs ./src/_ops-queue-ap-nfs-aa.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const NAMES = ["auctionauto", "autopartner", "nfsauto"];

const PROVIDER_ROWS = {
  auctionauto: [
    "Auctionauto",
    "auctionauto",
    "auction",
    "INTL",
    "https://auctionauto.org",
    20,
    "auctionauto-v3.3.1",
    "Korea + USA sharded by make/model (API 10k window). VIN-only persist. Photos filtered by VIN.",
  ],
  autopartner: [
    "Auto Partner",
    "autopartner",
    "auction",
    "BY",
    "https://cars.autopartner.by",
    25,
    "autopartner-v1.0.0",
    "Belarus Auto Partner. Copart/IAAI/Encar; detail /v/{VIN}; gallery filtered to this VIN only.",
  ],
  nfsauto: [
    "NFS Auto",
    "nfsauto",
    "dealer",
    "BY",
    "https://nfsauto.by",
    25,
    "nfsauto-v1.0.0",
    "NFS Auto Belarus — Korea + China via load-more API; Encar gallery filtered by lot id.",
  ],
};

const CFG = {
  auctionauto: {
    delayMs: 400,
    concurrency: 4,
    retryCount: 3,
    detailLevel: "full",
    skipRecentHours: 0,
    maxPages: 0,
    maxListings: 0,
    resetCrawlState: true,
    repeatHours: 5,
  },
  autopartner: {
    delayMs: 300,
    concurrency: 3,
    retryCount: 3,
    detailLevel: "full",
    skipRecentHours: 0,
    maxPages: 0,
    maxListings: 0,
    resetCrawlState: true,
    repeatHours: 5,
  },
  nfsauto: {
    delayMs: 250,
    concurrency: 4,
    retryCount: 3,
    detailLevel: "full",
    skipRecentHours: 0,
    maxPages: 0,
    maxListings: 0,
    resetCrawlState: true,
    repeatHours: 5,
  },
};

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

function localClient() {
  const url =
    process.env.LOCAL_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip";
  return new pg.Client({
    connectionString: url.includes("sslmode=") ? url : `${url}${url.includes("?") ? "&" : "?"}sslmode=disable`,
  });
}

async function ensureProvider(client, name) {
  const row = PROVIDER_ROWS[name];
  await client.query(
    `INSERT INTO providers (name, internal_name, type, country, base_url, enabled, rate_limit, parser_version, notes)
     VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8)
     ON CONFLICT (internal_name) DO UPDATE SET
       name = EXCLUDED.name,
       type = EXCLUDED.type,
       base_url = EXCLUDED.base_url,
       enabled = true,
       rate_limit = EXCLUDED.rate_limit,
       parser_version = EXCLUDED.parser_version,
       notes = EXCLUDED.notes,
       updated_at = now()`,
    row,
  );
}

async function queueOn(label, client) {
  const report = { label, actions: [] };
  for (const name of NAMES) {
    await ensureProvider(client, name);
    const { rows: prov } = await client.query(
      `SELECT id, enabled, parser_version FROM providers WHERE internal_name = $1`,
      [name],
    );
    if (!prov[0]) {
      report.actions.push({ name, error: "missing provider row after upsert" });
      continue;
    }
    // Cancel competing jobs for this provider so full can claim a slot cleanly.
    const cancelled = await client.query(
      `
      UPDATE collection_jobs
      SET status = 'cancelled',
          completed_at = COALESCE(completed_at, now()),
          error_message = COALESCE(error_message, 'superseded by AP/NFS/AA full_collection'),
          updated_at = now()
      WHERE provider_id = $1
        AND status IN ('pending','running','paused')
      RETURNING id, job_type
      `,
      [prov[0].id],
    );
    // Reuse newest full row (now cancelled) or insert.
    const priorFull = await client.query(
      `
      SELECT id FROM collection_jobs
      WHERE provider_id = $1 AND job_type = 'full_collection'
      ORDER BY id DESC LIMIT 1
      `,
      [prov[0].id],
    );
    const cfg = {
      ...CFG[name],
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    };
    if (priorFull.rows[0]) {
      const u = await client.query(
        `
        UPDATE collection_jobs
        SET status = 'pending',
            job_type = 'full_collection',
            job_config = $1::text,
            crawl_state = NULL,
            error_message = NULL,
            started_at = NULL,
            completed_at = NULL,
            updated_at = now() - interval '2 hours',
            created_at = now() - interval '2 days'
        WHERE id = $2
        RETURNING id, status
        `,
        [JSON.stringify(cfg), priorFull.rows[0].id],
      );
      report.actions.push({
        name,
        providerId: prov[0].id,
        reused: u.rows[0],
        cancelledOther: cancelled.rows,
      });
    } else {
      const created = await client.query(
        `
        INSERT INTO collection_jobs (provider_id, job_type, status, job_config, created_at, updated_at)
        VALUES ($1, 'full_collection', 'pending', $2, now() - interval '2 days', now() - interval '2 hours')
        RETURNING id, status
        `,
        [prov[0].id, JSON.stringify(cfg)],
      );
      report.actions.push({
        name,
        providerId: prov[0].id,
        created: created.rows[0],
        cancelledOther: cancelled.rows,
      });
    }
  }
  const snap = await client.query(
    `
    SELECT cj.id, p.internal_name, cj.job_type, cj.status,
      cj.job_config::jsonb->>'concurrency' AS conc,
      cj.job_config::jsonb->>'detailLevel' AS d,
      cj.items_processed
    FROM collection_jobs cj
    JOIN providers p ON p.id = cj.provider_id
    WHERE p.internal_name = ANY($1::text[])
      AND cj.status IN ('pending','running')
    ORDER BY p.internal_name, cj.id
    `,
    [NAMES],
  );
  report.snap = snap.rows;
  return report;
}

const target = (process.env.TARGET || "both").toLowerCase();
const reports = [];

if (target === "local" || target === "both") {
  const local = localClient();
  await local.connect();
  try {
    reports.push(await queueOn("local", local));
  } finally {
    await local.end();
  }
}

if (target === "prod" || target === "both") {
  const prod = new pg.Client(loadProd());
  await prod.connect();
  try {
    reports.push(await queueOn("prod", prod));
  } finally {
    await prod.end();
  }
}

console.log(JSON.stringify(reports, null, 2));
