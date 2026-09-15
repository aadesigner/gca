import pg from "pg";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip",
});
await c.connect();

const jobs = await c.query(`
  SELECT cj.id, pr.internal_name, cj.job_type, cj.status,
         cj.items_processed, cj.vins_found, cj.vins_new, cj.pages_processed,
         cj.listings_fetched, cj.started_at, cj.updated_at, cj.completed_at,
         left(coalesce(cj.error_message,''), 200) AS err,
         cj.job_config::jsonb ->> 'detailLevel' AS detail_level,
         cj.job_config::jsonb ->> 'concurrency' AS concurrency,
         cj.job_config::jsonb ->> 'fullCrawl' AS full_crawl,
         cj.job_config::jsonb ->> 'origins' AS origins,
         cj.crawl_state::jsonb ->> 'mode' AS mode,
         jsonb_array_length(coalesce(cj.crawl_state::jsonb -> 'shards', '[]'::jsonb)) AS shards,
         (
           SELECT count(*)::int FROM jsonb_array_elements(coalesce(cj.crawl_state::jsonb -> 'shards', '[]'::jsonb)) s
           WHERE s->>'status' = 'pending'
         ) AS shards_pending,
         (
           SELECT count(*)::int FROM jsonb_array_elements(coalesce(cj.crawl_state::jsonb -> 'shards', '[]'::jsonb)) s
           WHERE s->>'status' = 'done' OR s->>'status' = 'completed'
         ) AS shards_done,
         (
           SELECT count(*)::int FROM jsonb_array_elements(coalesce(cj.crawl_state::jsonb -> 'shards', '[]'::jsonb)) s
           WHERE s->>'status' = 'cooldown' OR s->>'status' = 'failed'
         ) AS shards_blocked
  FROM collection_jobs cj
  JOIN providers pr ON pr.id = cj.provider_id
  WHERE pr.internal_name IN ('import_motor','autoplac','japanesecartrade')
    AND cj.status IN ('pending','running','paused','failed')
  ORDER BY pr.internal_name, cj.id DESC
`);
console.log("=== active jobs ===");
for (const r of jobs.rows) {
  console.log(JSON.stringify(r, null, 2));
}

for (const name of ["import_motor", "autoplac", "japanesecartrade"]) {
  const recent = await c.query(
    `
    SELECT
      count(*) FILTER (WHERE l.created_at > now() - interval '1 hour')::int AS new_1h,
      count(*) FILTER (WHERE l.created_at > now() - interval '4 hours')::int AS new_4h,
      count(*) FILTER (WHERE l.created_at > now() - interval '24 hours')::int AS new_24h,
      count(*) FILTER (WHERE l.last_seen_at > now() - interval '1 hour')::int AS seen_1h,
      count(*) FILTER (WHERE l.last_seen_at > now() - interval '4 hours')::int AS seen_4h,
      max(l.created_at) AS newest_created,
      max(l.last_seen_at) AS newest_seen
    FROM listings l
    JOIN providers pr ON pr.id = l.provider_id AND pr.internal_name = $1
  `,
    [name],
  );
  console.log("\nlistings", name, recent.rows[0]);
}

// IM shard sample
const im = await c.query(`
  SELECT id, crawl_state::jsonb AS cs
  FROM collection_jobs
  WHERE id = 360
`);
const cs = im.rows[0]?.cs;
if (cs?.shards) {
  const byStatus = {};
  const samples = [];
  for (const s of cs.shards) {
    byStatus[s.status || "?"] = (byStatus[s.status || "?"] || 0) + 1;
    if (samples.length < 8 && (s.status === "cooldown" || s.status === "failed" || s.lastError)) {
      samples.push({
        id: s.id,
        status: s.status,
        country: s.country || s.filters?.country || s.label,
        listingsFetched: s.listingsFetched,
        discoverFailures: s.discoverFailures,
        lastError: String(s.lastError || "").slice(0, 120),
        cooldownUntil: s.cooldownUntil,
      });
    }
  }
  console.log("\nIM shardStatus", byStatus);
  console.log("IM problemShards", samples);
  console.log("IM currentShard", cs.currentShardId, "page", cs.page, "mode", cs.mode);
}

const ap = await c.query(`SELECT id, crawl_state::jsonb AS cs FROM collection_jobs WHERE id = 387`);
const apcs = ap.rows[0]?.cs;
if (apcs) {
  console.log("\nAutoplac crawl keys", Object.keys(apcs).slice(0, 30));
  console.log("Autoplac snippet", JSON.stringify(apcs).slice(0, 800));
}

await c.end();
