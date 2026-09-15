import pg from "pg";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip",
});
await c.connect();
const before = await c.query(
  "SELECT count(*)::int AS n FROM photos WHERE photo_group = 'interior_3d'",
);
console.log("local before", before.rows[0].n);
let total = 0;
for (;;) {
  const del = await c.query(`
    DELETE FROM photos
    WHERE id IN (
      SELECT id FROM photos WHERE photo_group = 'interior_3d' LIMIT 20000
    )
    RETURNING id
  `);
  total += del.rowCount;
  console.log("batch", del.rowCount, "total", total);
  if (!del.rowCount) break;
}
const mis = await c.query(`
  DELETE FROM photos
  WHERE source_url ILIKE '%InteriorImageRetriever%'
  RETURNING id
`);
console.log("misTagged", mis.rowCount);
const after = await c.query(
  "SELECT count(*)::int AS n FROM photos WHERE photo_group = 'interior_3d'",
);
console.log("local after", after.rows[0].n, "purged", total);
await c.end();
