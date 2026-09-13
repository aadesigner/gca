/**
 * Collapse observation rows that are identical on meaningful fields
 * (vehicle, provider, price, mileage, status) — photo-hash noise created extras.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/heal-duplicate-observations.mjs
 *   node --import ./scripts/load-env.mjs ./scripts/src/heal-duplicate-observations.mjs --apply
 *   node --import ./scripts/load-env.mjs ./scripts/src/heal-duplicate-observations.mjs --apply --prod
 */
import pg from "pg";

const apply = process.argv.includes("--apply");
const useProd = process.argv.includes("--prod");

function client() {
  if (useProd) {
    const password = process.env.PROD_PG_PASSWORD;
    if (!password) throw new Error("PROD_PG_PASSWORD required");
    return new pg.Client({
      host: process.env.PROD_PG_HOST ?? "yamanote.proxy.rlwy.net",
      port: Number(process.env.PROD_PG_PORT ?? "15622"),
      user: process.env.PROD_PG_USER ?? "postgres",
      password,
      database: process.env.PROD_PG_DATABASE ?? "railway",
      ssl: false,
      connectionTimeoutMillis: 20_000,
      query_timeout: 600_000,
    });
  }
  const localUrl = (
    process.env.LOCAL_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip"
  ).replace(/[?&]sslmode=[^&]+/i, "");
  return new pg.Client({
    connectionString: `${localUrl}${localUrl.includes("?") ? "&" : "?"}sslmode=disable`,
  });
}

const c = client();
await c.connect();

const stats = (
  await c.query(`
  SELECT count(*)::int AS groups, coalesce(sum(n - 1), 0)::int AS extra_rows
  FROM (
    SELECT count(*)::int AS n
    FROM vehicle_observations
    GROUP BY vehicle_id, provider_id,
      coalesce(price_amount::text, ''),
      coalesce(mileage::text, ''),
      lower(coalesce(listing_status, ''))
    HAVING count(*) > 1
  ) t
`)
).rows[0];

console.log(
  JSON.stringify(
    {
      target: useProd ? "prod" : "local",
      mode: apply ? "apply" : "dry-run",
      groups: stats.groups,
      extra_rows: stats.extra_rows,
    },
    null,
    2,
  ),
);

if (apply && Number(stats.extra_rows) > 0) {
  // Keep the earliest observation id per content group; delete the rest.
  const res = await c.query(`
    WITH ranked AS (
      SELECT id,
        row_number() OVER (
          PARTITION BY vehicle_id, provider_id,
            coalesce(price_amount::text, ''),
            coalesce(mileage::text, ''),
            lower(coalesce(listing_status, ''))
          ORDER BY observed_at ASC NULLS LAST, id ASC
        ) AS rn
      FROM vehicle_observations
    ),
    doomed AS (
      SELECT id FROM ranked WHERE rn > 1
    )
    DELETE FROM vehicle_observations vo
    USING doomed d
    WHERE vo.id = d.id
    RETURNING vo.id
  `);
  console.log(JSON.stringify({ deleted: res.rowCount ?? 0 }, null, 2));
}

await c.end();
