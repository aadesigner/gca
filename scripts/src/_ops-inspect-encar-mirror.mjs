import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const rows = await c.query(`
  SELECT
    count(*) FILTER (WHERE ph.created_at > now() - interval '3 hours')::int AS photos_3h,
    count(*) FILTER (
      WHERE ph.created_at > now() - interval '3 hours'
        AND ph.stored_path LIKE 'https://%'
    )::int AS cdn_3h,
    count(*) FILTER (
      WHERE ph.created_at > now() - interval '3 hours'
        AND ph.stored_path LIKE 'mirror-failed:%'
    )::int AS failed_3h,
    count(*) FILTER (
      WHERE ph.created_at > now() - interval '3 hours'
        AND (ph.stored_path IS NULL OR btrim(ph.stored_path) = '')
    )::int AS pending_3h
  FROM photos ph
  JOIN listings l ON l.id = ph.listing_id
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'encar'
`);
const sample = await c.query(`
  SELECT left(ph.source_url, 80) AS src, left(ph.stored_path, 80) AS stored
  FROM photos ph
  JOIN listings l ON l.id = ph.listing_id
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'encar'
    AND ph.created_at > now() - interval '3 hours'
  ORDER BY ph.id DESC
  LIMIT 6
`);
console.log(JSON.stringify({ counts: rows.rows[0], sample: sample.rows }, null, 2));
await c.end();
