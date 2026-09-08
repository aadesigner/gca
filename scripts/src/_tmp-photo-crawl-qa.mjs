/**
 * Quick prod QA: carpages/clutch photos + new-provider crawl health.
 */
import pg from "pg";

const c = new pg.Client({
  host: process.env.PROD_PG_HOST,
  port: Number(process.env.PROD_PG_PORT || 5432),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
  ssl: false,
});
await c.connect();

const providers = await c.query(`
  SELECT id, internal_name, enabled
  FROM providers
  WHERE internal_name ILIKE ANY(ARRAY['%carpage%','%clutch%','%ontario%'])
  ORDER BY internal_name
`);
console.log("=== providers ===");
console.log(providers.rows);

const jobs = await c.query(`
  SELECT p.internal_name, j.id, j.status, j.job_type,
         j.items_discovered, j.items_processed, j.vins_new, j.listings_fetched,
         j.error_message,
         round(extract(epoch from (now() - coalesce(j.updated_at, j.created_at)))/60)::int AS quiet_min,
         left(coalesce(j.job_config,''), 160) AS cfg
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.status IN ('pending','running')
     OR (j.completed_at > now() - interval '6 hours')
  ORDER BY
    CASE j.status WHEN 'running' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
    p.internal_name,
    j.id DESC
`);
console.log("\n=== active + recent completed (6h) ===");
for (const r of jobs.rows) {
  console.log(
    `${r.status.padEnd(10)} ${String(r.internal_name).padEnd(22)} #${r.id} ${r.job_type} disc=${r.items_discovered} ok=${r.items_processed} new=${r.vins_new} quiet=${r.quiet_min}m err=${r.error_message ? String(r.error_message).slice(0, 80) : "-"}`,
  );
}

const intake = await c.query(`
  SELECT p.internal_name,
         count(*) FILTER (WHERE l.created_at > now() - interval '1 hour')::int AS h1,
         count(*) FILTER (WHERE l.created_at > now() - interval '6 hours')::int AS h6,
         count(*)::int AS total
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name IN (
    'carpages','ontariocars','willhaben','aaaauto','autoplac','autoscout24',
    'bidexport','sauto','thebidrive','cars24ae','dubicars','otomoto','salvagebid'
  )
  GROUP BY p.internal_name
  ORDER BY h1 DESC, h6 DESC
`);
console.log("\n=== listing intake (new providers focus) ===");
console.log(intake.rows);

// Photo counts for carpages / ontariocars
const photoStats = await c.query(`
  WITH pids AS (
    SELECT id, internal_name FROM providers
    WHERE internal_name IN ('carpages','ontariocars')
  ),
  recent AS (
    SELECT l.id AS listing_id, l.source_id, p.internal_name, l.updated_at, l.created_at
    FROM listings l
    JOIN pids p ON p.id = l.provider_id
    WHERE l.updated_at > now() - interval '48 hours'
    ORDER BY l.updated_at DESC
    LIMIT 500
  ),
  pc AS (
    SELECT r.*,
      (SELECT count(*)::int FROM photos ph WHERE ph.listing_id = r.listing_id) AS photo_n,
      (SELECT ph.source_url FROM photos ph WHERE ph.listing_id = r.listing_id ORDER BY ph.sort_order NULLS LAST LIMIT 1) AS first_url
    FROM recent r
  )
  SELECT internal_name,
         count(*)::int AS sample_n,
         count(*) FILTER (WHERE photo_n = 0)::int AS zero,
         count(*) FILTER (WHERE photo_n = 1)::int AS one,
         count(*) FILTER (WHERE photo_n BETWEEN 2 AND 5)::int AS few,
         count(*) FILTER (WHERE photo_n >= 6)::int AS many,
         round(avg(photo_n)::numeric, 1) AS avg_photos
  FROM pc
  GROUP BY internal_name
`);
console.log("\n=== photo count distribution (updated 48h, sample 500) ===");
console.log(photoStats.rows);

const samples = await c.query(`
  WITH pids AS (
    SELECT id, internal_name FROM providers
    WHERE internal_name IN ('carpages','ontariocars')
  )
  SELECT p.internal_name, l.source_id, l.source_url,
         (SELECT count(*)::int FROM photos ph WHERE ph.listing_id = l.id) AS photo_n,
         (SELECT ph.source_url FROM photos ph WHERE ph.listing_id = l.id ORDER BY ph.sort_order NULLS LAST LIMIT 1) AS first_url,
         l.updated_at
  FROM listings l
  JOIN pids p ON p.id = l.provider_id
  WHERE l.updated_at > now() - interval '7 days'
  ORDER BY (SELECT count(*) FROM photos ph WHERE ph.listing_id = l.id) ASC, l.updated_at DESC
  LIMIT 25
`);
console.log("\n=== lowest-photo samples ===");
for (const r of samples.rows) {
  console.log(
    `${r.internal_name} src=${r.source_id} n=${r.photo_n} first=${String(r.first_url || "").slice(0, 120)} updated=${r.updated_at?.toISOString?.() ?? r.updated_at}`,
  );
}

const comingSoon = await c.query(`
  SELECT p.internal_name, count(*)::int AS n
  FROM photos ph
  JOIN listings l ON l.id = ph.listing_id
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name IN ('carpages','ontariocars')
    AND (
      ph.source_url ILIKE '%coming%soon%'
      OR ph.source_url ILIKE '%placeholder%'
      OR ph.source_url ILIKE '%no-image%'
      OR ph.source_url ILIKE '%noimage%'
      OR ph.source_url ILIKE '%default%'
      OR ph.source_url ILIKE '%stock%'
    )
  GROUP BY p.internal_name
`);
console.log("\n=== placeholder-ish photo urls ===");
console.log(comingSoon.rows);

await c.end();
