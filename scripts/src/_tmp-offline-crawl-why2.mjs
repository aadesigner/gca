import pg from "pg";

const c = new pg.Client({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip",
});
await c.connect();

const im = (await c.query(`SELECT crawl_state::jsonb AS cs, job_config::jsonb AS cfg FROM collection_jobs WHERE id=360`)).rows[0];
const pending = (im.cs.shards || []).filter((s) => s.status === "pending" || s.status === "running");
console.log("IM config", {
  fullCrawl: im.cfg.fullCrawl,
  origins: im.cfg.origins,
  maxPages: im.cfg.maxPages,
  skipRecentHours: im.cfg.skipRecentHours,
});
console.log(
  "IM pending shards",
  pending.map((s) => ({
    id: s.id,
    country: s.country || s.filters?.country,
    listingsFetched: s.listingsFetched,
    page: s.nextPage || s.page,
  })),
);

const ap = (await c.query(`SELECT crawl_state::jsonb AS cs FROM collection_jobs WHERE id=387`)).rows[0];
const by = {};
for (const s of ap.cs.shards || []) {
  by[s.status || "?"] = (by[s.status || "?"] || 0) + 1;
}
console.log("Autoplac shardStatus", by);
console.log(
  "Autoplac cooldown/failed",
  (ap.cs.shards || [])
    .filter((s) => s.status === "cooldown" || s.status === "failed")
    .map((s) => ({
      id: s.id,
      status: s.status,
      discoverFailures: s.discoverFailures,
      listingsFetched: s.listingsFetched,
      pagesProcessed: s.pagesProcessed,
      nextPage: s.nextPage,
      cooldownUntil: s.cooldownUntil,
      lastError: String(s.lastError || "").slice(0, 140),
    })),
);

await c.end();
