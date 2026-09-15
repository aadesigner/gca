/**
 * Batched delete of Bidrive placeholder photos only (og-default / bg_nodata).
 * Does not touch real gallery frames or other providers.
 *
 *   # local
 *   APPLY=1 node ./scripts/src/clean-thebidrive-placeholders.mjs
 *   # prod
 *   APPLY=1 node --import ./scripts/load-env.mjs ./scripts/src/clean-thebidrive-placeholders.mjs
 *   # or: DATABASE_URL='postgres://…prod…' APPLY=1 node ./scripts/src/clean-thebidrive-placeholders.mjs
 */
import pg from "pg";

const APPLY = process.env.APPLY === "1" || process.env.APPLY === "true";
const BATCH = Math.max(50, Number(process.env.BATCH || 150) || 150);
const cs =
  process.env.DATABASE_URL ||
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";

const c = new pg.Client({
  connectionString: cs,
  ssl: /127\.0\.0\.1|localhost/i.test(cs) ? false : { rejectUnauthorized: false },
  statement_timeout: 120_000,
});
await c.connect();

const provider = await c.query(`SELECT id FROM providers WHERE internal_name = 'thebidrive' LIMIT 1`);
const providerId = provider.rows[0]?.id;
if (!providerId) {
  console.log("no thebidrive provider");
  await c.end();
  process.exit(0);
}

const junkSql = `(source_url ILIKE '%og-default%' OR source_url ILIKE '%bg_nodata%' OR source_url ILIKE '%/resources/IMG/renew/bg/%')`;

const count = await c.query(
  `SELECT count(*)::int AS n
   FROM photos p
   JOIN listings l ON l.id = p.listing_id
   WHERE l.provider_id = $1 AND ${junkSql}`,
  [providerId],
);
console.log({ mode: APPLY ? "APPLY" : "DRY_RUN", providerId, placeholderPhotos: count.rows[0].n });

if (!APPLY || count.rows[0].n === 0) {
  await c.end();
  process.exit(0);
}

const { rows: lids } = await c.query(`SELECT id FROM listings WHERE provider_id = $1`, [providerId]);
let deleted = 0;
for (let i = 0; i < lids.length; i += BATCH) {
  const slice = lids.slice(i, i + BATCH).map((r) => r.id);
  const del = await c.query(
    `DELETE FROM photos WHERE listing_id = ANY($1::int[]) AND ${junkSql}`,
    [slice],
  );
  deleted += del.rowCount ?? 0;
  if (i === 0 || i % (BATCH * 20) === 0) console.log({ i, deleted });
}
console.log({ deleted });
await c.end();
