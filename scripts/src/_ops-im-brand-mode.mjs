/**
 * Switch Import Motor job 360 from country shards to brand-only crawl.
 * Rebuilds crawl_state with im-brand-* shards; clears country focus.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-im-brand-mode.mjs
 */
import pg from "pg";

const JOB_ID = Number(process.env.IM_JOB_ID || 360);

const BRANDS = [
  "audi",
  "mercedes-benz",
  "bmw",
  "volkswagen",
  "porsche",
  "hyundai",
  "toyota",
  "ford",
  "honda",
  "nissan",
  "kia",
  "lexus",
  "land-rover",
  "chevrolet",
  "jeep",
  "mazda",
  "subaru",
  "volvo",
  "tesla",
  "infiniti",
  "acura",
  "gmc",
  "dodge",
  "ram",
  "mitsubishi",
  "genesis",
  "mini",
  "jaguar",
  "bentley",
  "peugeot",
  "renault",
  "skoda",
  "opel",
  "suzuki",
  "fiat",
  "citroen",
  "seat",
  "cadillac",
  "chrysler",
  "buick",
  "lincoln",
  "alfa-romeo",
  "maserati",
];

function brandLabel(slug) {
  return slug
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

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
      WHERE status='running' AND id NOT IN (${JOB_ID}, 361, 362, 193)
      ORDER BY updated_at ASC
      LIMIT 2
    )
    RETURNING id
  `);
  console.log("paused to free slots:", paused.rows.map((r) => r.id));
}

const { rows } = await c.query(`SELECT job_config, status FROM collection_jobs WHERE id=$1`, [JOB_ID]);
if (!rows[0]) throw new Error(`job ${JOB_ID} missing`);

let cfg = {};
try {
  cfg = JSON.parse(rows[0].job_config || "{}");
} catch {
  cfg = {};
}

cfg.crawlMode = "brands";
cfg.brands = BRANDS;
cfg.countries = [];
cfg.fullCrawl = true;
cfg.concurrency = Math.min(10, Number(process.env.IMPORT_MOTOR_CONCURRENCY || 10) || 10);
cfg.delayMs = Math.max(75, Number(process.env.IMPORT_MOTOR_DELAY_MS || 85) || 85);
cfg.detailLevel = "full";
cfg.skipRecentHours = 0;
cfg.repeatHours = 6;
cfg.maxPages = 0;
cfg.maxListings = 0;
cfg.retryCount = 5;
delete cfg.origins;
delete cfg.fullCrawlCountries;
delete cfg.nextRunAt;

const shards = BRANDS.map((brand) => ({
  id: `im-brand-${brand}`,
  label: brandLabel(brand),
  status: "pending",
  nextPage: 1,
  pagesProcessed: 0,
  itemsDiscovered: 0,
  listingsFetched: 0,
  discoverFailures: 0,
  cooldownUntil: null,
  lastError: null,
  filters: {
    crawlMode: "brands",
    brands: [brand],
    countries: [],
    fullCrawl: true,
    concurrency: cfg.concurrency,
    delayMs: cfg.delayMs,
    detailLevel: "full",
    skipRecentHours: 0,
  },
}));

const state = {
  version: 1,
  strategy: "year",
  currentShardId: shards[0]?.id ?? null,
  shards,
  lastBlock: null,
  lastHealthSnapshot: null,
};

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

console.log(
  `IM ${JOB_ID} → brand mode (${BRANDS.length} shards) current=${state.currentShardId} conc=${cfg.concurrency}`,
);
await c.end();
