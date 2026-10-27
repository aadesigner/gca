/**
 * Snapshot local Encar job + coverage. No secrets.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-inspect-encar-offline.mjs
 */
import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const jobs = await c.query(`
  SELECT j.id, p.internal_name, j.status, j.job_type,
         j.items_discovered, j.items_processed, j.listings_fetched, j.pages_processed,
         j.vins_found, j.vins_new, j.new_observations, j.duplicates_skipped, j.items_failed,
         j.job_config::jsonb->>'detailLevel' AS detail_level,
         j.error_message, j.updated_at
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.status IN ('running', 'pending')
     OR p.internal_name = 'encar'
  ORDER BY CASE j.status WHEN 'running' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, j.id
`);

const stats = await c.query(`
  SELECT
    (SELECT count(*)::int FROM listings l JOIN providers p ON p.id = l.provider_id WHERE p.internal_name = 'encar') AS encar_listings,
    (SELECT count(*)::int FROM photos ph JOIN listings l ON l.id = ph.listing_id JOIN providers p ON p.id = l.provider_id WHERE p.internal_name = 'encar') AS encar_photos,
    (SELECT count(*)::int FROM vehicle_events ve
       JOIN listings l ON l.vehicle_id = ve.vehicle_id
       JOIN providers p ON p.id = l.provider_id
      WHERE p.internal_name = 'encar' AND ve.event_type = 'owner_change') AS owner_events,
    (SELECT count(*)::int FROM vehicle_events ve
       JOIN listings l ON l.vehicle_id = ve.vehicle_id
       JOIN providers p ON p.id = l.provider_id
      WHERE p.internal_name = 'encar' AND ve.event_type = 'accident') AS accident_events,
    (SELECT max_collection_jobs_parallel FROM settings WHERE id = 1) AS parallel
`);

const sample = await c.query(`
  SELECT l.source_id, l.vin, l.price_amount, l.mileage, l.last_seen_at,
         (SELECT count(*)::int FROM photos ph WHERE ph.listing_id = l.id) AS photos,
         (SELECT count(*)::int FROM vehicle_events ve WHERE ve.vehicle_id = l.vehicle_id AND ve.event_type = 'accident') AS accidents,
         (SELECT count(*)::int FROM vehicle_events ve WHERE ve.vehicle_id = l.vehicle_id AND ve.event_type = 'owner_change') AS owners
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'encar'
  ORDER BY l.last_seen_at DESC NULLS LAST
  LIMIT 5
`);

console.log(JSON.stringify({ jobs: jobs.rows, stats: stats.rows[0], recent: sample.rows }, null, 2));
await c.end();
