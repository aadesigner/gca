/**
 * Pause IM, rewrite front-sweep crawl_state (skip CF-stuck tiny shards), resume.
 */
import pg from "pg";

const url =
  process.env.DATABASE_URL ||
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";
const c = new pg.Client({
  connectionString: url.includes("sslmode=") ? url : `${url}?sslmode=disable`,
});
await c.connect();

await c.query(`UPDATE collection_jobs SET status='paused', updated_at=NOW() WHERE id=360`);
await new Promise((r) => setTimeout(r, 2500));

const { rows } = await c.query(`SELECT job_config FROM collection_jobs WHERE id=360`);
let cfg = {};
try {
  cfg = JSON.parse(rows[0].job_config || "{}");
} catch {
  cfg = {};
}

const PRIORITY = [
  "me", "mk", "xk", "ba", "al", "si", "hr", "bg", "rs", "ro", "gr",
  "ge", "am", "az", "md", "ee", "lv", "lt", "sk", "hu", "cz", "fi", "ie", "pt",
  "at", "be", "nl", "se", "no", "dk", "ch", "pl", "es", "it", "fr", "de", "gb", "ua",
  "cy", "jo", "lb", "bh", "qa", "kw", "om", "ae", "il", "iq", "sa", "tr", "ru",
  "*rest",
];
const SKIP_TINY = new Set(["me", "mk", "xk", "ba", "si"]);

const merged = {
  ...cfg,
  crawlMode: "countries",
  countries: PRIORITY,
  fullCrawl: true,
  preferOrigins: ["korean"],
  newCarsSweep: true,
  concurrency: 4,
  delayMs: 120,
  skipRecentHours: 0,
  detailLevel: "full",
  maxPages: 0,
  maxListings: 0,
  source: "im_new_cars_front_sweep",
};
delete merged.nextRunAt;
delete merged.origins;

const shards = PRIORITY.map((cc) => {
  const id = `im-${cc === "*rest" ? "rest" : cc}`;
  const skip = SKIP_TINY.has(cc);
  return {
    id,
    label: cc === "*rest" ? "Rest of world" : cc.toUpperCase(),
    status: skip ? "completed" : "pending",
    nextPage: 1,
    pagesProcessed: 0,
    listingsFetched: 0,
    discoverFailures: 0,
    cooldownUntil: null,
    lastError: skip ? "skipped tiny/CF for front sweep" : null,
    filters: {
      ...merged,
      crawlMode: "countries",
      countries: [cc],
      fullCrawl: true,
      preferOrigins: ["korean"],
      maxPages: 25,
    },
  };
});

const start = shards.find((s) => s.status === "pending");
const crawlState = {
  version: 1,
  strategy: "year",
  currentShardId: start?.id ?? null,
  shards,
};

await c.query(
  `
  UPDATE collection_jobs
  SET status='pending',
      job_config=$2::text,
      crawl_state=$3::text,
      error_message=NULL,
      started_at=NULL,
      completed_at=NULL,
      updated_at=NOW()-interval '1 day',
      created_at=LEAST(created_at, NOW()-interval '2 days')
  WHERE id=$1
  `,
  [360, JSON.stringify(merged), JSON.stringify(crawlState)],
);

console.log({
  paused_then_pending: true,
  start: start?.id,
  pending: shards.filter((s) => s.status === "pending").length,
  skipped: [...SKIP_TINY],
  note: "Pass Cloudflare once in the debug Chrome tab on import-motor.com/buyer-locations/al",
});
await c.end();
