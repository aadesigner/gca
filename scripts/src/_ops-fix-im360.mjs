/**
 * Unstick Import Motor job 360 for new-only focus crawl with fresh cookies.
 */
import pg from "pg";

const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const FOCUS = ["me", "mk", "xk", "ba", "al", "si", "hr", "bg", "rs", "ro", "gr", "ge"];
const FOCUS_SET = new Set(FOCUS);

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

// Free a couple slots if needed
const running = await c.query(`SELECT count(*)::int AS n FROM collection_jobs WHERE status='running'`);
const capRow = await c.query(`SELECT max_collection_jobs_parallel AS m FROM settings WHERE id=1`);
const cap = Number(capRow.rows[0]?.m ?? 6);
console.log(`running=${running.rows[0].n} cap=${cap}`);

if (running.rows[0].n >= cap) {
  const paused = await c.query(`
    UPDATE collection_jobs
    SET status='paused', updated_at=now()
    WHERE id IN (
      SELECT id FROM collection_jobs
      WHERE status='running' AND id NOT IN (360, 361, 362, 193)
      ORDER BY updated_at ASC
      LIMIT 2
    )
    RETURNING id
  `);
  console.log("paused to free slots:", paused.rows.map((r) => r.id));
}

const { rows } = await c.query(`SELECT crawl_state, job_config, status FROM collection_jobs WHERE id=$1`, [
  JOB_ID,
]);
if (!rows[0]) throw new Error(`job ${JOB_ID} missing`);

let state = {};
let cfg = {};
try {
  state = JSON.parse(rows[0].crawl_state || "{}");
} catch {
  state = {};
}
try {
  cfg = JSON.parse(rows[0].job_config || "{}");
} catch {
  cfg = {};
}

cfg.fullCrawl = true;
cfg.countries = FOCUS;
cfg.fullCrawlCountries = FOCUS;
cfg.concurrency = Math.min(12, Number(process.env.IMPORT_MOTOR_CONCURRENCY || 12) || 12);
cfg.delayMs = Math.max(70, Number(process.env.IMPORT_MOTOR_DELAY_MS || 70) || 70);
cfg.detailLevel = "full";
cfg.skipRecentHours = 0;
cfg.repeatHours = 6;
cfg.maxPages = 0;
cfg.maxListings = 0;
delete cfg.origins;
delete cfg.nextRunAt;

if (!Array.isArray(state.shards)) state.shards = [];
for (const s of state.shards) {
  const m = /^im-([a-z]{2}|rest)$/.exec(s.id || "");
  const cc = m?.[1] === "rest" ? "*rest" : m?.[1];
  if (!cc || !FOCUS_SET.has(cc)) {
    s.status = "completed";
    s.lastError = s.lastError || "deferred: focus only";
    continue;
  }
  if (s.status === "cooldown") {
    s.status = "pending";
    s.cooldownUntil = null;
  }
  if (s.lastError) s.lastError = null;
  s.discoverFailures = 0;
}
// Ensure focus shards exist
for (const cc of FOCUS) {
  const id = `im-${cc}`;
  if (!state.shards.some((s) => s.id === id)) {
    state.shards.push({
      id,
      label: cc.toUpperCase(),
      status: "pending",
      nextPage: 1,
      pagesProcessed: 0,
      filters: { countries: [cc], fullCrawl: true, fullCrawlCountries: FOCUS },
    });
  }
}
state.currentShardId = state.shards.find((s) => FOCUS_SET.has(s.id?.replace(/^im-/, "")) && s.status !== "completed")?.id || "im-me";

await c.query(
  `
  UPDATE collection_jobs
  SET status='pending',
      job_type='full_collection',
      job_config=$1,
      crawl_state=$2,
      completed_at=NULL,
      error_message=NULL,
      updated_at=now()
  WHERE id=$3
`,
  [JSON.stringify(cfg), JSON.stringify(state), JOB_ID],
);

console.log(`IM ${JOB_ID} → pending current=${state.currentShardId} conc=${cfg.concurrency}`);
await c.end();
