import pg from "pg";

const c = new pg.Client({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable",
});
await c.connect();

const fleet = await c.query(`
  SELECT count(*) FILTER (WHERE status='running')::int running,
         count(*) FILTER (WHERE status='pending')::int pending
  FROM collection_jobs WHERE status IN ('running','pending')
`);
const im = await c.query(`
  SELECT j.id, j.status, j.job_type,
    COALESCE(j.items_processed,0)::int proc,
    round(extract(epoch from (NOW()-j.updated_at))/60)::int quiet_m
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE p.internal_name='import_motor'
  ORDER BY j.updated_at DESC LIMIT 3
`);
const mismatch = await c.query(`
  SELECT count(*)::int n
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  WHERE pr.internal_name = 'import_motor'
    AND l.source_id ~ '^im-\\d{6,}$'
    AND COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) IS NOT NULL
    AND COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) <> (regexp_match(l.source_id, '^im-(\\d{6,})$', 'i'))[1]
`);
const recent = await c.query(`
  SELECT count(*)::int photos_2h,
    count(*) FILTER (
      WHERE COALESCE(
        (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
        (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
      ) IS NOT NULL
      AND COALESCE(
        (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
        (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
      ) <> (regexp_match(l.source_id, '^im-(\\d{6,})$', 'i'))[1]
    )::int bad_2h
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  WHERE pr.internal_name = 'import_motor' AND p.created_at > NOW() - interval '2 hours'
`);
console.log({ fleet: fleet.rows[0], im: im.rows, mismatch: mismatch.rows[0], recent: recent.rows[0] });
await c.end();
