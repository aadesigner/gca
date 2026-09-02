/**
 * Production photo mirror stats — requires PROD_PG_PASSWORD.
 * Run: node --import ./scripts/load-env.mjs ./scripts/src/photo-mirror-prod-stats.mjs
 */
import pg from "pg";

if (!process.env.PROD_PG_PASSWORD) {
  console.error("Set PROD_PG_PASSWORD");
  process.exit(1);
}

const pool = new pg.Pool({
  host: process.env.PROD_PG_HOST ?? "tokaido.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT ?? "11425"),
  user: process.env.PROD_PG_USER ?? "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE ?? "railway",
  ssl: process.env.PROD_PG_SSL === "1" ? { rejectUnauthorized: false } : false,
});

const { rows: totals } = await pool.query(`
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE stored_path ~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/')::int AS cdn,
    count(*) FILTER (WHERE stored_path IS NULL)::int AS pending,
    count(*) FILTER (WHERE stored_path IS NOT NULL AND stored_path !~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/')::int AS other_stored
  FROM photos
`);

const { rows: last24h } = await pool.query(`
  SELECT
    count(*)::int AS created,
    count(*) FILTER (WHERE stored_path ~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/')::int AS cdn,
    count(*) FILTER (WHERE stored_path IS NULL)::int AS pending
  FROM photos
  WHERE created_at > now() - interval '24 hours'
`);

const { rows: last4h } = await pool.query(`
  SELECT
    count(*)::int AS created,
    count(*) FILTER (WHERE stored_path ~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/')::int AS cdn,
    count(*) FILTER (WHERE stored_path IS NULL)::int AS pending
  FROM photos
  WHERE created_at > now() - interval '4 hours'
`);

const { rows: byProvider } = await pool.query(`
  SELECT COALESCE(p.internal_name, 'unknown') AS provider,
    count(*)::int AS total,
    count(*) FILTER (WHERE ph.stored_path ~* 'imgsv\\.getcarapi\\.com')::int AS cdn,
    count(*) FILTER (WHERE ph.stored_path IS NULL)::int AS pending
  FROM photos ph
  LEFT JOIN listings l ON l.id = ph.listing_id
  LEFT JOIN providers p ON p.id = l.provider_id
  GROUP BY p.internal_name
  HAVING count(*) FILTER (WHERE ph.stored_path IS NULL) > 100
     OR count(*) > 5000
  ORDER BY pending DESC NULLS LAST
  LIMIT 15
`);

const { rows: imPending } = await pool.query(`
  SELECT count(*)::int AS pending
  FROM photos ph
  WHERE ph.stored_path IS NULL
    AND (ph.source_url ~* 'import-motor|importmotor' OR ph.source_url ~* 'ibb\\.co|imgbb')
`);

const { rows: recentPending } = await pool.query(`
  SELECT COALESCE(p.internal_name, 'unknown') AS provider,
    count(*)::int AS pending_new
  FROM photos ph
  LEFT JOIN listings l ON l.id = ph.listing_id
  LEFT JOIN providers p ON p.id = l.provider_id
  WHERE ph.stored_path IS NULL AND ph.created_at > now() - interval '24 hours'
  GROUP BY p.internal_name
  ORDER BY pending_new DESC
  LIMIT 10
`);

console.log(JSON.stringify({
  totals: totals[0],
  last24h: last24h[0],
  last4h: last4h[0],
  imOrEphemeralPending: imPending[0]?.pending,
  topProvidersByPending: byProvider,
  pendingLast24hByProvider: recentPending,
}, null, 2));

await pool.end();
