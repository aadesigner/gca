import pg from "pg";

const c = new pg.Client({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip",
});
await c.connect();

const r = await c.query(`
  SELECT id, status, updated_at, started_at,
    job_config::jsonb->>'fullCrawl' AS full_crawl,
    job_config::jsonb->>'preferOrigins' AS prefer,
    job_config::jsonb->>'origins' AS origins,
    job_config::jsonb->>'crawlMode' AS mode,
    (SELECT count(*) FROM jsonb_array_elements(crawl_state::jsonb->'shards') s WHERE s->>'status'='pending') AS pending,
    (SELECT count(*) FROM jsonb_array_elements(crawl_state::jsonb->'shards') s WHERE s->>'status'='completed') AS completed,
    crawl_state::jsonb->>'currentShardId' AS current
  FROM collection_jobs WHERE id=360
`);
console.log("job", r.rows[0]);

const shard = await c.query(`
  SELECT s->>'id' AS id, s->>'status' AS status,
         s->'filters'->>'fullCrawl' AS full,
         s->'filters'->>'origins' AS origins,
         s->'filters'->>'preferOrigins' AS prefer,
         s->>'nextPage' AS page,
         s->>'listingsFetched' AS fetched
  FROM collection_jobs, jsonb_array_elements(crawl_state::jsonb->'shards') s
  WHERE id=360
  ORDER BY CASE WHEN s->>'id' = (crawl_state::jsonb->>'currentShardId') THEN 0
                WHEN s->>'status'='pending' THEN 1 ELSE 2 END
  LIMIT 6
`);
console.log("shards", shard.rows);

const recent = await c.query(`
  SELECT
    count(*) FILTER (WHERE l.created_at > now()-interval '15 minutes')::int AS new_15m,
    count(*) FILTER (WHERE l.last_seen_at > now()-interval '15 minutes')::int AS seen_15m,
    max(l.created_at) AS newest_created,
    max(l.last_seen_at) AS newest_seen
  FROM listings l
  JOIN providers p ON p.id=l.provider_id
  WHERE p.internal_name='import_motor'
`);
console.log("listings", recent.rows[0]);

const ap = await c.query(`SELECT id, status, updated_at FROM collection_jobs WHERE id IN (387,390) ORDER BY id`);
console.log("others", ap.rows);

const cfg = (
  await c.query(`SELECT job_config FROM collection_jobs WHERE id=360`)
).rows[0].job_config;
const parsed = typeof cfg === "string" ? JSON.parse(cfg) : cfg;
console.log("job_config_keys", {
  fullCrawl: parsed.fullCrawl,
  origins: parsed.origins,
  preferOrigins: parsed.preferOrigins,
  source: parsed.source,
  crawlMode: parsed.crawlMode,
});

await c.end();
