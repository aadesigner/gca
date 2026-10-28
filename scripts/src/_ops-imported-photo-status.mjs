/**
 * CDN status for this catalog import (Encar photos since import start).
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
if (!/^(localhost|127\.0\.0\.1|::1)$/i.test(host)) throw new Error(host);

const since = process.argv[2] || "2026-10-28T15:21:00Z";
const c = new pg.Client({ connectionString: url });
await c.connect();
const encar = (
  await c.query(
    `
    SELECT
      count(*)::int AS photos,
      count(*) FILTER (WHERE ph.stored_path ~* 'imgsv\\.getcarapi\\.com')::int AS cdn,
      count(*) FILTER (WHERE ph.stored_path ILIKE 'mirror-failed:%')::int AS failed,
      count(*) FILTER (WHERE ph.stored_path IS NULL OR btrim(ph.stored_path) = '')::int AS pending
    FROM photos ph
    JOIN listings l ON l.id = ph.listing_id
    JOIN providers p ON p.id = l.provider_id
    WHERE p.internal_name = 'encar'
      AND ph.created_at >= $1
      AND ph.source_url ILIKE '%encar.com%'
    `,
    [since],
  )
).rows[0];
const cars = (
  await c.query(
    `
    SELECT
      count(*)::int AS listings,
      count(*) FILTER (WHERE cdn_n > 0)::int AS with_cdn
    FROM (
      SELECT l.id,
        count(*) FILTER (WHERE ph.stored_path ~* 'imgsv\\.getcarapi\\.com')::int AS cdn_n
      FROM listings l
      JOIN providers p ON p.id = l.provider_id
      LEFT JOIN photos ph ON ph.listing_id = l.id AND ph.created_at >= $1
      WHERE p.internal_name = 'encar'
        AND l.updated_at >= $1
      GROUP BY l.id
    ) t
    `,
    [since],
  )
).rows[0];
const pendingHosts = (
  await c.query(
    `
    SELECT
      CASE
        WHEN source_url ILIKE '%encar.com%' THEN 'encar'
        WHEN source_url ILIKE '%ibb.co%' THEN 'ibb'
        WHEN source_url ILIKE '%carstat%' THEN 'carstat'
        ELSE split_part(split_part(source_url, '://', 2), '/', 1)
      END AS host,
      count(*)::int AS n
    FROM photos
    WHERE created_at >= $1
      AND (stored_path IS NULL OR btrim(stored_path) = '')
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 12
    `,
    [since],
  )
).rows;
console.log(JSON.stringify({ since, encar, cars, pendingHosts }, null, 2));
await c.end();
