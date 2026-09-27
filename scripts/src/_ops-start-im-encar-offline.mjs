/**
 * Offline 50/50: Import Motor brands (after country pass) + Encar newest-first full.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-start-im-encar-offline.mjs
 */
import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const paused = await c.query(`
  UPDATE collection_jobs
  SET status = 'paused',
      error_message = coalesce(error_message, 'paused — IM+Encar offline slot'),
      updated_at = now()
  WHERE status IN ('running', 'pending')
    AND id NOT IN (360, 361, 362)
  RETURNING id
`);
console.log("paused others", paused.rows.map((r) => r.id).join(",") || "(none)");

await c.query(`
  UPDATE collection_jobs
  SET status = 'paused',
      error_message = 'parked while Encar full newest-first runs',
      updated_at = now()
  WHERE id = 361
`);

await c.query(`UPDATE settings SET max_collection_jobs_parallel = 2 WHERE id = 1`);

const BRANDS = [
  "audi","mercedes-benz","bmw","volkswagen","porsche","hyundai","toyota","ford","honda","nissan",
  "kia","lexus","land-rover","chevrolet","jeep","mazda","subaru","volvo","tesla","infiniti",
  "acura","gmc","dodge","ram","mitsubishi","genesis","mini","jaguar","bentley","peugeot",
  "renault","skoda","opel","suzuki","fiat","citroen","seat","cadillac","chrysler","buick",
  "lincoln","alfa-romeo","maserati",
];

function brandLabel(slug) {
  return slug.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

const imCfg = {
  source: "offline_im_encar_50_50",
  crawlMode: "brands",
  brands: BRANDS,
  countries: [],
  fullCrawl: true,
  concurrency: 6,
  delayMs: 85,
  detailLevel: "full",
  skipRecentHours: 0,
  maxPages: 0,
  maxListings: 0,
  retryCount: 5,
  repeatHours: 6,
};
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
    concurrency: 6,
    delayMs: 85,
    detailLevel: "full",
    skipRecentHours: 0,
  },
}));
const imState = {
  version: 1,
  strategy: "year",
  currentShardId: shards[0]?.id ?? null,
  shards,
  lastBlock: null,
  lastHealthSnapshot: null,
};

await c.query(
  `UPDATE collection_jobs
   SET status='pending',
       job_type='full_collection',
       job_config=$1,
       crawl_state=$2,
       completed_at=NULL,
       error_message=NULL,
       updated_at=now() - interval '1 hour'
   WHERE id=360`,
  [JSON.stringify(imCfg), JSON.stringify(imState)],
);
console.log("im 360 brand shards", shards.length);

const encarCfg = {
  sort: "ModifiedDate",
  carType: "all",
  detailLevel: "full",
  skipRecentHours: 0,
  maxPages: 0,
  maxListings: 0,
  delayMs: 120,
  concurrency: 6,
  maxEncarConcurrency: 8,
  minGapMs: 60,
  retryCount: 4,
  repeatHours: 6,
};
await c.query(
  `UPDATE collection_jobs
   SET status='pending',
       job_type='full_collection',
       job_config=$1,
       crawl_state=NULL,
       pages_processed=0,
       items_discovered=0,
       items_processed=0,
       listings_fetched=0,
       completed_at=NULL,
       error_message=NULL,
       updated_at=now() - interval '1 hour'
   WHERE id=362`,
  [JSON.stringify(encarCfg)],
);
console.log("encar 362 newest-first full reset");

const check = await c.query(`
  SELECT j.id, p.internal_name, j.status, j.job_type,
         left(j.job_config, 120) cfg
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.id IN (360,361,362)
`);
console.log(check.rows);
const slots = await c.query(`SELECT max_collection_jobs_parallel FROM settings WHERE id=1`);
console.log("parallel", slots.rows[0]);
await c.end();
