import pg from "pg";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15_000,
});
await c.connect();
const del = await c.query(`
  DELETE FROM photos ph
  USING listings l, providers p
  WHERE ph.listing_id = l.id
    AND l.provider_id = p.id
    AND p.internal_name = 'seobuk'
    AND (
      ph.source_url ILIKE '%.gif%'
      OR ph.source_url ILIKE '%/assets/custom/%'
      OR ph.source_url ILIKE '%loading%'
    )
  RETURNING ph.id
`);
console.log("LOCAL purged junk photos", del.rowCount);
await c.end();
