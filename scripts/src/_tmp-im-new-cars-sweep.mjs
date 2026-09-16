/**
 * Kick local IM #360 onto a "new cars" front-of-catalog sweep:
 * - reopen country shards from page 1 (where new stock appears)
 * - keep fullCrawl + prefer Korean
 * - preserve job; clear deep-page progress that only hits known VINs
 */
import pg from "pg";

const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const url =
  process.env.DATABASE_URL ||
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";

const c = new pg.Client({
  connectionString: url.includes("sslmode=")
    ? url
    : `${url}${url.includes("?") ? "&" : "?"}sslmode=disable`,
});
await c.connect();

const PRIORITY = [
  "me", "mk", "xk", "ba", "al", "si", "hr", "bg", "rs", "ro", "gr",
  "ge", "am", "az", "md", "ee", "lv", "lt", "sk", "hu", "cz", "fi", "ie", "pt",
  "at", "be", "nl", "se", "no", "dk", "ch", "pl", "es", "it", "fr", "de", "gb", "ua",
  "cy", "jo", "lb", "bh", "qa", "kw", "om", "ae", "il", "iq", "sa", "tr", "ru",
  "*rest",
];

const { rows } = await c.query(
  `SELECT id, status, job_config, crawl_state FROM collection_jobs WHERE id = $1`,
  [JOB_ID],
);
const job = rows[0];
if (!job) {
  console.error("IM job missing", JOB_ID);
  process.exit(1);
}

let cfg = {};
try {
  cfg = typeof job.job_config === "string" ? JSON.parse(job.job_config) : job.job_config || {};
} catch {
  cfg = {};
}

const merged = {
  ...cfg,
  crawlMode: "countries",
  countries: PRIORITY,
  fullCrawl: true,
  preferOrigins: ["korean"],
  // Front-of-list new-stock pass — don't burn days on deep known pages.
  maxPagesPerCountry: 25,
  newCarsSweep: true,
  concurrency: Math.min(Number(cfg.concurrency) || 5, 6),
  delayMs: Math.max(Number(cfg.delayMs) || 85, 85),
  skipRecentHours: 0,
  detailLevel: "full",
  maxPages: 0,
  maxListings: 0,
  retryCount: 5,
  source: "im_new_cars_front_sweep",
};
delete merged.nextRunAt;
delete merged.resetCrawlState;
delete merged.origins; // fullCrawl

const shards = PRIORITY.map((cc) => ({
  id: `im-${cc === "*rest" ? "rest" : cc}`,
  label: cc === "*rest" ? "Rest of world" : cc.toUpperCase(),
  status: "pending",
  nextPage: 1,
  pagesProcessed: 0,
  listingsFetched: 0,
  discoverFailures: 0,
  cooldownUntil: null,
  lastError: null,
  filters: {
    ...merged,
    crawlMode: "countries",
    countries: [cc],
    fullCrawl: true,
    preferOrigins: ["korean"],
    maxPages: 25,
  },
}));

const crawlState = {
  version: 1,
  strategy: "year",
  currentShardId: shards[0]?.id ?? null,
  shards,
};

// Pause → rewrite → pending so worker doesn't race
await c.query(
  `UPDATE collection_jobs SET status='paused', updated_at=NOW() WHERE id=$1 AND status='running'`,
  [JOB_ID],
);

await c.query(
  `
  UPDATE collection_jobs
  SET status = 'pending',
      started_at = NULL,
      completed_at = NULL,
      error_message = NULL,
      job_config = $2,
      crawl_state = $3,
      updated_at = NOW() - interval '1 day',
      created_at = LEAST(created_at, NOW() - interval '2 days')
  WHERE id = $1
  `,
  [JOB_ID, JSON.stringify(merged), JSON.stringify(crawlState)],
);

console.log({
  id: JOB_ID,
  action: "im_new_cars_front_sweep",
  shards: shards.length,
  first: shards[0]?.id,
  maxPagesPerCountry: 25,
  status: "pending",
});

await c.end();
