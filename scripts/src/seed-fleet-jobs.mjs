#!/usr/bin/env node
/**
 * Ensure fleet crawl jobs exist for priority KR/US market providers.
 *
 * Local (default): jobs created as paused — worker will not run them.
 * Production: jobs pending with staggered nextRunAt + 8–13h repeatHours.
 *
 *   node --import ../../scripts/load-env.mjs scripts/src/seed-fleet-jobs.mjs
 *   FLEET_JOBS_START=1 node --import ../../scripts/load-env.mjs scripts/src/seed-fleet-jobs.mjs
 */
import pg from "pg";

const { Pool } = pg;

/** Optional production DB ids — resolved by internal_name when missing. */
const TARGETS = [
  { id: 55686, internalName: "autoinside" },
  { id: 55683, internalName: "lotteautoauction" },
  { id: 55680, internalName: "heydealer" },
  { id: 55613, internalName: "encar", skip: true },
  { id: 55605, internalName: "autobellglobal" },
  { id: 55604, internalName: "bobaedream" },
  { id: 55603, internalName: "kcar" },
  { id: 55567, internalName: "autobell" },
  { id: 55565, internalName: "autohub" },
  { id: 55554, internalName: "rbautotrade" },
  { id: 55553, internalName: "senaauto" },
  { id: 55552, internalName: "carpoolkr" },
  { id: 26, internalName: "charancha" },
  { id: 25, internalName: "kbchachacha" },
  { id: 24, internalName: "autowini" },
];

const REPEAT_HOURS = [8, 9, 10, 11, 12, 13];

function hash(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

function repeatHours(internalName) {
  if (internalName === "encar") return 11;
  if (internalName === "import_motor") return 4;
  return REPEAT_HOURS[hash(internalName) % REPEAT_HOURS.length];
}

function staggerMinutes(internalName) {
  const repeatMins = repeatHours(internalName) * 60;
  return hash(`${internalName}:stagger`) % Math.max(30, repeatMins - 15);
}

function jobType(internalName) {
  const refresh = new Set([
    "autowini",
    "kcar",
    "autobell",
    "carpoolkr",
    "charancha",
    "autohub",
    "heydealer",
    "bobaedream",
    "lotteautoauction",
    "autoinside",
    "autobellglobal",
    "rbautotrade",
    "senaauto",
  ]);
  return refresh.has(internalName) ? "listing_refresh" : "full_collection";
}

function fleetConfig(internalName) {
  const repeat = repeatHours(internalName);
  const cfg = {
    repeatHours: repeat,
    staggerMinutes: staggerMinutes(internalName),
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: Math.max(0, repeat - 2),
    detailLevel: jobType(internalName) === "listing_refresh" ? "standard" : "full",
    maxPages: 0,
    maxListings: 0,
  };
  return cfg;
}

function shouldAutoStart() {
  if (process.env.FLEET_JOBS_START === "1") return true;
  if (process.env.FLEET_JOBS_START === "0") return false;
  return process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);
}

function nextRunAt(internalName, autoStart) {
  if (!autoStart) return null;
  const mins = staggerMinutes(internalName);
  return new Date(Date.now() + mins * 60_000).toISOString();
}

async function resolveProvider(pool, target) {
  if (target.id) {
    const byId = await pool.query(
      `SELECT id, internal_name FROM providers WHERE id = $1`,
      [target.id],
    );
    if (byId.rows[0]) return byId.rows[0];
  }
  const byName = await pool.query(
    `SELECT id, internal_name FROM providers WHERE internal_name = $1`,
    [target.internalName],
  );
  return byName.rows[0] ?? null;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const autoStart = shouldAutoStart();
  console.log(`Fleet job seed — autoStart=${autoStart} (paused locally unless FLEET_JOBS_START=1)`);

  for (const target of TARGETS) {
    if (target.skip) {
      console.log(`⊘ skip ${target.internalName} (pinned fleet jobs)`);
      continue;
    }
    const provider = await resolveProvider(pool, target);
    if (!provider) {
      console.warn(`✗ provider not found: ${target.internalName} (id=${target.id ?? "—"})`);
      continue;
    }

    const jt = jobType(provider.internal_name);
    const cfg = fleetConfig(provider.internal_name);
    const runAt = nextRunAt(provider.internal_name, autoStart);
    if (runAt) cfg.nextRunAt = runAt;

    const existing = await pool.query(
      `SELECT id, status, job_type FROM collection_jobs WHERE provider_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [provider.id],
    );

    if (existing.rows[0]) {
      const jobId = existing.rows[0].id;
      const status = autoStart ? "pending" : "paused";
      await pool.query(
        `UPDATE collection_jobs
         SET status = $2,
             job_type = $3,
             job_config = $4::jsonb,
             error_message = CASE WHEN $2 = 'paused' THEN COALESCE(error_message, 'Local seed — paused (FLEET_JOBS_START=0)') ELSE NULL END,
             completed_at = CASE WHEN $2 = 'pending' THEN NULL ELSE completed_at END
         WHERE id = $1`,
        [jobId, status, jt, JSON.stringify(cfg)],
      );
      console.log(`↻ updated job ${jobId} ${provider.internal_name} → ${status} (${jt}, repeat ${cfg.repeatHours}h)`);
      continue;
    }

    const status = autoStart ? "pending" : "paused";
    const inserted = await pool.query(
      `INSERT INTO collection_jobs (provider_id, job_type, status, job_config)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id`,
      [provider.id, jt, status, JSON.stringify(cfg)],
    );
    console.log(`✓ created job ${inserted.rows[0].id} ${provider.internal_name} → ${status}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
