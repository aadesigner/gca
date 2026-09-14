import pg from "pg";

const c = new pg.Client({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable",
});
await c.connect();
await c.query("SET statement_timeout = 30000");
const r = await c.query(`
WITH recent AS (
  SELECT p.source_url, l.source_id
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  WHERE pr.internal_name = 'import_motor'
    AND p.created_at > NOW() - interval '30 minutes'
  ORDER BY p.created_at DESC
  LIMIT 2000
)
SELECT count(*)::int n,
  count(*) FILTER (
    WHERE COALESCE(
      (regexp_match(source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) IS NOT NULL
    AND source_id ~ '^im-\\d{6,}$'
    AND COALESCE(
      (regexp_match(source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) <> (regexp_match(source_id, '^im-(\\d{6,})$', 'i'))[1]
  )::int bad
FROM recent
`);
console.log(r.rows[0]);
await c.end();
