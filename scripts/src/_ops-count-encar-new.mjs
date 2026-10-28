/**
 * Local-only Encar new-car counts.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-count-encar-new.mjs
 */
import pg from "pg";

const url = process.env.DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(url.replace(/^postgres(ql)?:/i, "http:")).hostname;
  } catch {
    return "";
  }
})();
if (!/^(localhost|127\.0\.0\.1|::1)$/i.test(host) || /rlwy\.net|railway\.(app|internal)/i.test(url)) {
  throw new Error(`Refusing count — host ${host}`);
}

const c = new pg.Client({ connectionString: url });
await c.connect();

const job = (
  await c.query(`
    SELECT id, status, pages_processed, listings_fetched, vins_new, items_failed,
           started_at, updated_at
    FROM collection_jobs WHERE id = 362
  `)
).rows[0];

const crawlStart = "2026-10-27T20:00:00Z";

const counts = (
  await c.query(
    `
    SELECT
      (SELECT count(*)::int FROM vehicles v
         JOIN listings l ON l.vehicle_id = v.id
         JOIN providers p ON p.id = l.provider_id
        WHERE p.internal_name = 'encar') AS encar_vehicles_total,
      (SELECT count(*)::int FROM listings l
         JOIN providers p ON p.id = l.provider_id
        WHERE p.internal_name = 'encar') AS encar_listings_total,
      (SELECT count(*)::int FROM vehicles v
         JOIN listings l ON l.vehicle_id = v.id
         JOIN providers p ON p.id = l.provider_id
        WHERE p.internal_name = 'encar'
          AND v.created_at >= $1) AS new_vehicles_since_crawl,
      (SELECT count(*)::int FROM listings l
         JOIN providers p ON p.id = l.provider_id
        WHERE p.internal_name = 'encar'
          AND l.created_at >= $1) AS new_listings_since_crawl
    `,
    [crawlStart],
  )
).rows[0];

console.log(JSON.stringify({ host, job, counts }, null, 2));
await c.end();
