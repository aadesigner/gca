import pg from "pg";

const ALL = [
  "me", "mk", "xk", "ba", "al", "si", "hr", "bg", "rs", "ro", "gr", "ge", "am", "az", "md",
  "ee", "lv", "lt", "sk", "hu", "cz", "fi", "ie", "pt", "at", "be", "nl", "se", "no", "dk",
  "ch", "pl", "es", "it", "fr", "de", "gb", "ua", "cy", "jo", "lb", "bh", "qa", "kw", "om",
  "ae", "il", "iq", "sa", "tr", "ru", "*rest",
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const r = await pool.query("SELECT job_config, crawl_state FROM collection_jobs WHERE id = 360");
const cfg = JSON.parse(r.rows[0].job_config);
delete cfg.origins;
Object.assign(cfg, {
  fullCrawlCountries: ALL,
  countries: ALL,
  skipRecentHours: 0,
  maxPages: 0,
  maxListings: 0,
  concurrency: 10,
  delayMs: 50,
  retryCount: 5,
  detailLevel: "full",
});

const state = JSON.parse(r.rows[0].crawl_state);
let reset = 0;
for (const shard of state.shards) {
  if (shard.id === "im-al" && shard.filters?.fullCrawl && shard.status === "completed") continue;
  const cc =
    shard.filters?.countries?.[0] ||
    (shard.id === "im-rest" ? "*rest" : shard.id.replace(/^im-/, ""));
  shard.filters = {
    ...shard.filters,
    countries: [cc],
    fullCrawl: true,
    fullCrawlCountries: ALL,
    detailLevel: "full",
    skipRecentHours: 0,
    maxPages: 0,
    maxListings: 0,
    concurrency: 10,
    delayMs: 50,
    retryCount: 5,
  };
  delete shard.filters.origins;
  shard.status = "pending";
  shard.nextPage = 1;
  shard.pagesProcessed = 0;
  shard.listingsFetched = 0;
  shard.discoverFailures = 0;
  shard.cooldownUntil = null;
  shard.lastError = null;
  delete shard.expectedResultTotal;
  delete shard.expectedTotalPages;
  reset++;
}
state.currentShardId = "im-me";

await pool.query(
  `UPDATE collection_jobs SET job_config = $1, crawl_state = $2, status = 'failed', error_message = 'Patched for full crawl — resume with resetProgress:false' WHERE id = 360`,
  [JSON.stringify(cfg), JSON.stringify(state)],
);

const me = state.shards.find((s) => s.id === "im-me");
console.log(JSON.stringify({ reset, current: state.currentShardId, imMe: { full: me?.filters?.fullCrawl, origins: me?.filters?.origins, page: me?.nextPage } }, null, 2));
await pool.end();
