/**
 * Restore Import Motor job 360 brand shard cursors after an accidental
 * repeatHours wipe (brand mode used to rebuild from page 1).
 *
 * Sources max page per brand from recent API terminal logs, then writes
 * crawl_state nextPage = max+1 and clears nextRunAt so the job resumes now.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-restore-im-progress.mjs
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import pg from "pg";

const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const TERMINALS =
  process.env.CURSOR_TERMINALS_DIR ||
  "C:/Users/Pc/.cursor/projects/c-Users-Pc-Downloads-gca/terminals";

function maxPagesFromLogs() {
  const by = {};
  if (!existsSync(TERMINALS)) return by;
  for (const f of readdirSync(TERMINALS).filter((x) => x.endsWith(".txt"))) {
    const t = readFileSync(join(TERMINALS, f), "utf8").replace(/\x1b\[[0-9;]*m/g, "");
    const re =
      /Discovering listings on shard page\n\s+jobId: 360\n\s+shardId: "(im-brand-[^"]+)"\n\s+shardLabel: "[^"]*"\n\s+page: (\d+)/g;
    let m;
    while ((m = re.exec(t))) {
      const id = m[1];
      const page = Number(m[2]);
      if (!by[id] || page > by[id]) by[id] = page;
    }
  }
  return by;
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const { rows } = await c.query(
  `SELECT job_config, crawl_state, status, pages_processed, listings_fetched FROM collection_jobs WHERE id=$1`,
  [JOB_ID],
);
if (!rows[0]) {
  console.error("job not found", JOB_ID);
  process.exit(1);
}

const cfg = JSON.parse(rows[0].job_config || "{}");
const st = JSON.parse(rows[0].crawl_state || "{}");
const maxByShard = maxPagesFromLogs();

let updated = 0;
for (const s of st.shards || []) {
  if (!String(s.id || "").startsWith("im-brand-")) continue;
  const maxPage = maxByShard[s.id];
  const resumeAt = maxPage ? maxPage + 1 : Math.max(1, Number(s.nextPage) || 1);
  if (resumeAt > (Number(s.nextPage) || 1)) {
    s.nextPage = resumeAt;
    s.pagesProcessed = Math.max(Number(s.pagesProcessed) || 0, resumeAt - 1);
    updated++;
  }
  s.status = "pending";
  s.lastError = null;
  s.cooldownUntil = null;
  s.filters = {
    ...(s.filters || {}),
    crawlMode: "brands",
    fullCrawl: true,
    countries: [],
    detailLevel: "full",
    skipRecentHours: 0,
  };
}

// Resume at the first brand that still has meaningful depth progress, else first pending.
const ordered = [...(st.shards || [])].filter((s) => String(s.id).startsWith("im-brand-"));
const deepest = [...ordered].sort(
  (a, b) => (Number(b.nextPage) || 1) - (Number(a.nextPage) || 1),
)[0];
st.currentShardId = deepest?.id || ordered[0]?.id || st.currentShardId;

delete cfg.nextRunAt;
cfg.crawlMode = "brands";
cfg.fullCrawl = true;
cfg.countries = [];
cfg.repeatHours = Number(cfg.repeatHours ?? 6);

await c.query(
  `UPDATE collection_jobs
   SET status='pending',
       error_message=NULL,
       completed_at=NULL,
       started_at=NULL,
       crawl_state=$1,
       job_config=$2,
       updated_at=now() - interval '1 hour'
   WHERE id=$3`,
  [JSON.stringify(st), JSON.stringify(cfg), JOB_ID],
);

const sample = ordered
  .filter((s) => (Number(s.nextPage) || 1) > 1)
  .slice(0, 12)
  .map((s) => `${s.id}@${s.nextPage}`);

console.log(
  JSON.stringify(
    {
      jobId: JOB_ID,
      prevStatus: rows[0].status,
      shardsUpdatedFromLogs: updated,
      currentShardId: st.currentShardId,
      sampleResume: sample,
      logHits: Object.keys(maxByShard).length,
    },
    null,
    2,
  ),
);

await c.end();
