/**
 * Count Encar photos from this crawl still waiting for Cloudflare.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-encar-photo-pending.mjs
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
if (!/^(localhost|127\.0\.0\.1|::1)$/i.test(host)) throw new Error(`Refusing ${host}`);

const crawlStart = "2026-10-27T20:00:00Z";
const c = new pg.Client({ connectionString: url });
await c.connect();
const row = (
  await c.query(
    `
    SELECT
      count(*)::int AS photos,
      count(*) FILTER (
        WHERE ph.stored_path ~* 'imgsv\\.getcarapi\\.com'
      )::int AS cdn,
      count(*) FILTER (
        WHERE ph.stored_path ILIKE 'mirror-failed:%'
      )::int AS failed,
      count(*) FILTER (
        WHERE ph.stored_path IS NULL OR btrim(ph.stored_path) = ''
      )::int AS pending
    FROM photos ph
    JOIN listings l ON l.id = ph.listing_id
    JOIN providers p ON p.id = l.provider_id
    WHERE p.internal_name = 'encar'
      AND ph.created_at >= $1
    `,
    [crawlStart],
  )
).rows[0];
console.log(JSON.stringify({ host, crawlStart, ...row }, null, 2));
await c.end();
