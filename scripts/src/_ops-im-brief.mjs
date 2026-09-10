import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const { rows } = await c.query(
  `SELECT status, pages_processed, listings_fetched, vins_found, vins_new,
          items_processed, items_failed, started_at, updated_at,
          crawl_state
   FROM collection_jobs WHERE id=360`,
);
const job = rows[0];
if (!job) {
  console.log("job 360 missing");
  process.exit(1);
}
const st = JSON.parse(job.crawl_state || "{}");
const shards = st.shards || [];
const by = {};
for (const s of shards) by[s.status] = (by[s.status] || 0) + 1;

const active = shards.find((s) => s.id === st.currentShardId) || shards.find((s) => s.status === "active");
const completed = shards.filter((s) => s.status === "completed").map((s) => s.id?.replace("im-brand-", ""));
const pending = shards.filter((s) => s.status === "pending").map((s) => s.id?.replace("im-brand-", ""));
const cooldown = shards.filter((s) => s.status === "cooldown").map((s) => ({
  id: s.id?.replace("im-brand-", ""),
  page: s.nextPage,
  err: String(s.lastError || "").slice(0, 80),
}));

const recent = await c.query(
  `SELECT count(*)::int AS n FROM listings l
   JOIN providers p ON p.id = l.provider_id
   WHERE p.internal_name = 'import_motor' AND l.created_at > now() - interval '1 hour'`,
);
const today = await c.query(
  `SELECT count(*)::int AS n FROM listings l
   JOIN providers p ON p.id = l.provider_id
   WHERE p.internal_name = 'import_motor' AND l.created_at >= date_trunc('day', now())`,
);

console.log(
  JSON.stringify(
    {
      status: job.status,
      pages: job.pages_processed,
      listings: job.listings_fetched,
      vins: job.vins_found,
      vinsNew: job.vins_new,
      processed: job.items_processed,
      failed: job.items_failed,
      startedAt: job.started_at,
      updatedAt: job.updated_at,
      ageMin: Math.round((Date.now() - new Date(job.updated_at).getTime()) / 60000),
      shardCounts: by,
      current: active
        ? {
            brand: active.id?.replace("im-brand-", ""),
            page: active.nextPage,
            status: active.status,
            err: active.lastError ? String(active.lastError).slice(0, 100) : null,
          }
        : null,
      completedBrands: completed.length,
      pendingBrands: pending.length,
      cooldown,
      listingsLastHour: recent.rows[0].n,
      listingsToday: today.rows[0].n,
      lastBlock: st.lastBlock || null,
    },
    null,
    2,
  ),
);
await c.end();
