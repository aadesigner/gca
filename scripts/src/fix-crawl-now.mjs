/**
 * One-shot crawl fix: boost Encar aggression, heal IM stuck shard, restart jobs via API recycle.
 * Run: node --import ./scripts/load-env.mjs ./scripts/src/fix-crawl-now.mjs
 */
import pg from "pg";

const ENCAR_FULL = 362;
const ENCAR_REFRESH = 361;
const IM_JOB = 360;

const AGGRESSIVE = {
  concurrency: 16,
  delayMs: 100,
  skipRecentHours: 0,
  maxPages: 0,
  maxListings: 0,
  retryCount: 3,
};

function mergeConfig(existing, patch) {
  const base = existing ? JSON.parse(existing) : {};
  return JSON.stringify({ ...base, ...patch });
}

function healCrawlState(raw) {
  if (!raw) return raw;
  const st = JSON.parse(raw);
  const now = Date.now();
  let fixed = 0;
  for (const shard of st.shards ?? []) {
    if (shard.status === "cooldown" && shard.cooldownUntil && Date.parse(shard.cooldownUntil) <= now) {
      shard.status = "pending";
      shard.cooldownUntil = null;
      fixed++;
    }
    if (shard.lastError?.includes("buyer-locations returned 0 countries")) {
      shard.status = "pending";
      shard.cooldownUntil = null;
      shard.lastError = null;
      shard.discoverFailures = 0;
      fixed++;
    }
    if ((shard.discoverFailures ?? 0) >= 8 && (shard.listingsFetched ?? 0) === 0) {
      shard.discoverFailures = 0;
      shard.status = "pending";
      shard.cooldownUntil = null;
      shard.lastError = null;
      fixed++;
    }
  }
  if (st.currentShardId) {
    const cur = st.shards?.find((s) => s.id === st.currentShardId);
    if (cur && cur.status === "cooldown") {
      st.currentShardId = null;
      fixed++;
    }
  }
  return { json: JSON.stringify(st), fixed };
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const [im] = (
    await pool.query("SELECT job_config, crawl_state, status FROM collection_jobs WHERE id=$1", [IM_JOB])
  ).rows;
  const imHealed = healCrawlState(im.crawl_state);
  await pool.query(
    `UPDATE collection_jobs
     SET job_config=$1, crawl_state=$2, status='pending', error_message=NULL, completed_at=NULL
     WHERE id=$3`,
    [
      mergeConfig(im.job_config, { ...AGGRESSIVE, concurrency: 10, delayMs: 50, retryCount: 5 }),
      imHealed.json,
      IM_JOB,
    ],
  );
  console.log(`IM job ${IM_JOB}: re-queued, crawl_state fixes=${imHealed.fixed}`);

  const [encFull] = (
    await pool.query("SELECT job_config, crawl_state FROM collection_jobs WHERE id=$1", [ENCAR_FULL])
  ).rows;
  const encHealed = healCrawlState(encFull.crawl_state);
  await pool.query(
    `UPDATE collection_jobs
     SET job_config=$1, crawl_state=$2, status='pending', error_message=NULL, completed_at=NULL
     WHERE id=$3`,
    [
      mergeConfig(encFull.job_config, { ...AGGRESSIVE, detailLevel: "full" }),
      encHealed.json,
      ENCAR_FULL,
    ],
  );
  console.log(`Encar full ${ENCAR_FULL}: re-queued aggressive cfg, crawl fixes=${encHealed.fixed}`);

  const [encRef] = (
    await pool.query("SELECT job_config, crawl_state FROM collection_jobs WHERE id=$1", [ENCAR_REFRESH])
  ).rows;
  const refHealed = healCrawlState(encRef.crawl_state);
  await pool.query(
    `UPDATE collection_jobs
     SET job_config=$1, crawl_state=$2, status='pending', error_message=NULL, completed_at=NULL
     WHERE id=$3`,
    [
      mergeConfig(encRef.job_config, {
        ...AGGRESSIVE,
        detailLevel: "standard",
        repeatHours: 11,
      }),
      refHealed.json,
      ENCAR_REFRESH,
    ],
  );
  console.log(`Encar refresh ${ENCAR_REFRESH}: re-queued aggressive cfg, crawl fixes=${refHealed.fixed}`);

  const verify = await pool.query(`
    SELECT id, status, job_config, error_message
    FROM collection_jobs WHERE id IN ($1,$2,$3) ORDER BY id
  `, [IM_JOB, ENCAR_REFRESH, ENCAR_FULL]);
  for (const row of verify.rows) {
    const cfg = JSON.parse(row.job_config);
    console.log(`  ${row.id} ${row.status} concurrency=${cfg.concurrency} delay=${cfg.delayMs} skip=${cfg.skipRecentHours}`);
  }
} finally {
  await pool.end();
}

console.log("\nDone. Restart API to apply (running worker holds old in-memory state).");
