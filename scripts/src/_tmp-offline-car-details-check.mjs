import pg from "pg";
const c = new pg.Client({ connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable" });
await c.connect();

for (const id of [360, 387, 390]) {
  const j = (await c.query(
    `SELECT id, status, items_processed, vins_found, vins_new, pages_processed, updated_at,
            crawl_state::jsonb->>'currentShardId' AS current,
            (SELECT count(*) FROM jsonb_array_elements(crawl_state::jsonb->'shards') s WHERE s->>'status'='pending') AS pending,
            (SELECT count(*) FROM jsonb_array_elements(crawl_state::jsonb->'shards') s WHERE s->>'status'='active') AS active,
            (SELECT count(*) FROM jsonb_array_elements(crawl_state::jsonb->'shards') s WHERE s->>'status'='completed') AS completed,
            left(coalesce(error_message,''), 120) AS err,
            left(job_config::text, 220) AS cfg
     FROM collection_jobs WHERE id=$1`,
    [id],
  )).rows[0];
  console.log("\nJOB", j);
  const shards = (await c.query(
    `SELECT s->>'id' AS id, s->>'status' AS st, s->>'listingsFetched' AS fetched,
            s->>'pagesProcessed' AS pages, left(coalesce(s->>'lastError',''), 100) AS err
     FROM collection_jobs, jsonb_array_elements(crawl_state::jsonb->'shards') s
     WHERE id=$1 AND s->>'status' IN ('active','completed')
     ORDER BY s->>'status', s->>'id' LIMIT 20`,
    [id],
  )).rows;
  console.log("shards_active_completed", shards);
}

// Photo/detail quality last 24h for offline providers
const q = await c.query(`
  SELECT p.internal_name,
         count(*)::int AS listings_24h,
         count(*) FILTER (WHERE photo_n >= 3)::int AS with_3plus_photos,
         count(*) FILTER (WHERE photo_n = 0)::int AS zero_photos,
         count(*) FILTER (WHERE v.make IS NULL OR v.model IS NULL OR v.year IS NULL)::int AS missing_core,
         round(avg(photo_n)::numeric,1) AS avg_photos
  FROM (
    SELECT l.id, l.provider_id, l.vehicle_id,
           (SELECT count(*) FROM photos ph WHERE ph.listing_id=l.id AND coalesce(ph.photo_group,'gallery')='gallery') AS photo_n
    FROM listings l
    WHERE l.last_seen_at > now() - interval '24 hours'
  ) x
  JOIN providers p ON p.id=x.provider_id
  JOIN vehicles v ON v.id=x.vehicle_id
  WHERE p.internal_name IN ('import_motor','autoplac','japanesecartrade')
  GROUP BY p.internal_name
`);
console.log("\nquality_24h", q.rows);

const samples = await c.query(`
  SELECT p.internal_name, v.vin, v.make, v.model, v.year, l.mileage,
         (SELECT count(*)::int FROM photos ph WHERE ph.listing_id=l.id AND coalesce(ph.photo_group,'gallery')='gallery') AS photos,
         left(coalesce(l.title,''),50) AS title
  FROM listings l
  JOIN providers p ON p.id=l.provider_id
  JOIN vehicles v ON v.id=l.vehicle_id
  WHERE p.internal_name IN ('import_motor','autoplac','japanesecartrade')
    AND l.last_seen_at > now() - interval '24 hours'
  ORDER BY l.last_seen_at DESC
  LIMIT 12
`);
console.log("samples", samples.rows);
await c.end();
