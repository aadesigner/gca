import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = path.join(ROOT, ".env");
let env = fs.readFileSync(envPath, "utf8");
const upsert = (key, value) => {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(env)) env = env.replace(re, `${key}=${value}`);
  else env += `\n${key}=${value}\n`;
};
upsert("IMPORT_MOTOR_FULL_CRAWL", "1");
upsert("FLEET_AUTO_START", "0");
upsert("IMPORT_MOTOR_CDP_TABS", "2");
upsert("IMPORT_MOTOR_CDP_PARALLEL", "1");
upsert("IMPORT_MOTOR_CONCURRENCY", "2");
upsert("IMPORT_MOTOR_DELAY_MS", "500");
upsert("CARSTAT_CDP_TABS", "2");
upsert("CARSTAT_CDP_PARALLEL", "1");
fs.writeFileSync(envPath, env);

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query(`UPDATE settings SET max_collection_jobs_parallel = 2 WHERE id = 1`);

const extras = await c.query(`
  SELECT id, job_config FROM collection_jobs
  WHERE id NOT IN (360, 362, 414)
    AND status IN ('running','pending','paused','failed')
`);
for (const row of extras.rows) {
  let cfg = {};
  try {
    cfg = JSON.parse(row.job_config || "{}");
  } catch {
    cfg = {};
  }
  cfg.pausedForMirrorDrain = true;
  await c.query(
    `UPDATE collection_jobs
     SET status='paused',
         job_config=$1,
         error_message='paused — safe IM/Encar/Carstat only',
         updated_at=now()
     WHERE id=$2`,
    [JSON.stringify(cfg), row.id],
  );
}

const im = await c.query(`SELECT job_config, crawl_state FROM collection_jobs WHERE id=360`);
const imCfg = JSON.parse(im.rows[0].job_config || "{}");
const imSt = JSON.parse(im.rows[0].crawl_state || "{}");
delete imCfg.nextRunAt;
imCfg.crawlMode = "brands";
imCfg.fullCrawl = true;
imCfg.detailLevel = "full";
imCfg.concurrency = 2;
imCfg.delayMs = 500;
imCfg.skipRecentHours = 0;
imCfg.maxPages = 0;
imCfg.maxListings = 0;
imCfg.repeatHours = 6;
let wallReset = 0;
for (const s of imSt.shards || []) {
  const err = String(s.lastError || "");
  const walled = /catalog wall|401|403|Unauthorized|not readable|Cloudflare|challenge/i.test(err);
  if (s.status === "completed" && walled) {
    s.status = "pending";
    s.lastError = null;
    s.cooldownUntil = null;
    s.expectedTotalPages = null;
    s.expectedResultTotal = null;
    s.discoverFailures = 0;
    wallReset += 1;
  }
  if (s.filters && typeof s.filters === "object") {
    s.filters.concurrency = 2;
    s.filters.delayMs = 500;
    s.filters.detailLevel = "full";
  }
}
imSt.currentShardId = null;
imSt.lastBlock = null;
await c.query(
  `UPDATE collection_jobs
   SET status='pending', job_config=$1, crawl_state=$2, error_message=null,
       completed_at=null, updated_at=now()
   WHERE id=360`,
  [JSON.stringify(imCfg), JSON.stringify(imSt)],
);

const en = await c.query(`SELECT job_config FROM collection_jobs WHERE id=362`);
const enCfg = JSON.parse(en.rows[0].job_config || "{}");
delete enCfg.nextRunAt;
enCfg.fullCrawl = true;
enCfg.detailLevel = "full";
enCfg.sort = enCfg.sort || "ModifiedDate";
enCfg.maxEncarConcurrency = 2;
enCfg.minGapMs = 500;
enCfg.delayMs = Math.max(400, Number(enCfg.delayMs) || 400);
enCfg.concurrency = 2;
enCfg.skipRecentHours = 0;
enCfg.maxPages = 0;
enCfg.maxListings = 0;
await c.query(
  `UPDATE collection_jobs
   SET job_config=$1, error_message=null, updated_at=now()
   WHERE id=362 AND status IN ('running','pending')`,
  [JSON.stringify(enCfg)],
);

const cs = await c.query(`SELECT job_config FROM collection_jobs WHERE id=414`);
const csCfg = JSON.parse(cs.rows[0].job_config || "{}");
csCfg.fullCrawl = true;
csCfg.detailLevel = "full";
csCfg.concurrency = 2;
csCfg.delayMs = 400;
csCfg.maxPages = 0;
csCfg.maxListings = 0;
csCfg.skipRecentHours = 0;
csCfg.nextRunAt = new Date(Date.now() + 40 * 60 * 1000).toISOString();
await c.query(
  `UPDATE collection_jobs
   SET status='pending', job_config=$1, error_message=null, completed_at=null, updated_at=now()
   WHERE id=414`,
  [JSON.stringify(csCfg)],
);

const jobs = await c.query(`
  SELECT id, status, pages_processed, items_processed
  FROM collection_jobs WHERE id IN (360,362,414) ORDER BY id
`);
const extraLive = await c.query(`
  SELECT id, status FROM collection_jobs
  WHERE status IN ('running','pending') AND id NOT IN (360,362,414)
`);
console.log({
  wallReset,
  extraHeld: extras.rowCount,
  extraLive: extraLive.rows,
  jobs: jobs.rows,
});
await c.end();

const tmp = path.join(ROOT, "scripts/.im-auth.tmp.json");
if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
