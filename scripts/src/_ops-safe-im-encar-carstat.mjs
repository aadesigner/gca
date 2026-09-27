/**
 * Apply fresh IM cookies + park extra jobs. Slow triad: IM / Encar / Carstat.
 * Does not reset crawl_state. Does not print secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = path.join(ROOT, ".env");

const authFile = path.join(ROOT, "scripts/.im-auth.tmp.json");
const fileAuth = fs.existsSync(authFile) ? JSON.parse(fs.readFileSync(authFile, "utf8")) : {};
const CF = String(process.env.IM_CF_CLEARANCE || fileAuth.cf_clearance || "").trim();
const SESSION = String(process.env.IM_SESSION || fileAuth.import_motor_session || "").trim();
const XSRF = String(process.env.IM_XSRF || fileAuth.xsrf || "").trim();
if (!CF || !SESSION || !XSRF) {
  console.error("missing IM_CF_CLEARANCE / IM_SESSION / IM_XSRF");
  process.exit(1);
}

const env = fs.readFileSync(envPath, "utf8");
const locale = env.match(/IMPORT_MOTOR_COOKIE=.*?;\s*locale=([^;\s]+)/)?.[1];
const cookie = [
  `cf_clearance=${CF}`,
  `import_motor_session=${SESSION}`,
  `XSRF-TOKEN=${XSRF}`,
  locale ? `locale=${locale}` : null,
]
  .filter(Boolean)
  .join("; ");

let next = env.replace(/^IMPORT_MOTOR_COOKIE=.*$/m, `IMPORT_MOTOR_COOKIE=${cookie}`);
next = next
  .replace(/^IMPORT_MOTOR_CDP_TABS=.*$/m, "IMPORT_MOTOR_CDP_TABS=2")
  .replace(/^IMPORT_MOTOR_CDP_PARALLEL=.*$/m, "IMPORT_MOTOR_CDP_PARALLEL=1")
  .replace(/^CARSTAT_CDP_TABS=.*$/m, "CARSTAT_CDP_TABS=2")
  .replace(/^CARSTAT_CDP_PARALLEL=.*$/m, "CARSTAT_CDP_PARALLEL=1")
  .replace(/^IMPORT_MOTOR_CONCURRENCY=.*$/m, "IMPORT_MOTOR_CONCURRENCY=2")
  .replace(/^IMPORT_MOTOR_DELAY_MS=.*$/m, "IMPORT_MOTOR_DELAY_MS=500")
  .replace(/^AUTOPLAC_CDP_TABS=.*$/m, "AUTOPLAC_CDP_TABS=2")
  .replace(/^AUTOPLAC_CDP_PARALLEL=.*$/m, "AUTOPLAC_CDP_PARALLEL=1");
fs.writeFileSync(envPath, next);
process.env.IMPORT_MOTOR_COOKIE = cookie;
console.log("env cookie+pacing updated", { cf: CF.length, session: SESSION.length, xsrf: XSRF.length });

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const paused = await c.query(`
  UPDATE collection_jobs
  SET status='paused', error_message='paused — safe IM/Encar/Carstat only', updated_at=now()
  WHERE status IN ('running','pending')
    AND id NOT IN (360, 362, 414)
  RETURNING id
`);
await c.query(`UPDATE settings SET max_collection_jobs_parallel = 2 WHERE id = 1`);

async function patchJob(id, mutate) {
  const row = await c.query(`SELECT job_config, crawl_state FROM collection_jobs WHERE id=$1`, [id]);
  if (!row.rows[0]) throw new Error(`job ${id} missing`);
  const cfg = JSON.parse(row.rows[0].job_config || "{}");
  const st = JSON.parse(row.rows[0].crawl_state || "{}");
  mutate(cfg, st);
  await c.query(
    `UPDATE collection_jobs
     SET status='pending', job_config=$1, crawl_state=$2, error_message=null,
         completed_at=null, updated_at=now()
     WHERE id=$3`,
    [JSON.stringify(cfg), JSON.stringify(st), id],
  );
}

await patchJob(360, (cfg, st) => {
  delete cfg.nextRunAt;
  cfg.crawlMode = "brands";
  cfg.fullCrawl = true;
  cfg.detailLevel = "full";
  cfg.concurrency = 2;
  cfg.delayMs = 500;
  cfg.skipRecentHours = 0;
  cfg.maxPages = 0;
  cfg.maxListings = 0;
  let cleared = 0;
  for (const s of st.shards || []) {
    if (!String(s.id || "").startsWith("im-brand-")) continue;
    if (s.status === "cooldown" || /cloudflare|challenge|not readable|websocket/i.test(String(s.lastError || ""))) {
      s.status = "pending";
      s.lastError = null;
      s.cooldownUntil = null;
      cleared += 1;
    }
    if (s.filters && typeof s.filters === "object") {
      s.filters.concurrency = 2;
      s.filters.delayMs = 500;
      s.filters.detailLevel = "full";
    }
  }
  cfg._safeCleared = cleared;
});

await patchJob(362, (cfg) => {
  delete cfg.nextRunAt;
  cfg.fullCrawl = true;
  cfg.detailLevel = "full";
  cfg.sort = cfg.sort || "ModifiedDate";
  cfg.maxEncarConcurrency = 2;
  cfg.minGapMs = 500;
  cfg.delayMs = Math.max(400, Number(cfg.delayMs) || 400);
  cfg.skipRecentHours = 0;
  cfg.maxPages = 0;
  cfg.maxListings = 0;
});

await patchJob(414, (cfg) => {
  delete cfg.nextRunAt;
  cfg.fullCrawl = true;
  cfg.detailLevel = "full";
  cfg.concurrency = 2;
  cfg.delayMs = Math.max(400, Number(cfg.delayMs) || 400);
  cfg.maxPages = 0;
  cfg.maxListings = 0;
  cfg.skipRecentHours = 0;
});

const jobs = await c.query(
  `SELECT id, status, pages_processed, items_processed FROM collection_jobs WHERE id IN (360,362,414) ORDER BY id`,
);
console.log("paused", paused.rows.map((r) => r.id));
console.log("ready", jobs.rows);
await c.end();
