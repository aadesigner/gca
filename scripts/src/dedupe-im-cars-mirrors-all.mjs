await import("../load-env.mjs");
import pg from "pg";

const dryRun = process.argv.includes("--dry-run");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const countSql = `
  SELECT count(*)::int AS n
  FROM photos ph
  WHERE ph.source_url ~* 'cars2?\\.import-motor\\.com'
    AND EXISTS (
      SELECT 1 FROM photos a
      WHERE a.listing_id = ph.listing_id
        AND (
          a.source_url ~* 'vis\\.iaai\\.com/resizer'
          OR a.source_url ~* 'cs\\.copart\\.com'
          OR a.source_url ~* 'ci\\.encar\\.com'
        )
    )
`;

const before = await c.query(countSql);
console.log("cars mirrors to delete", before.rows[0].n);
if (dryRun) {
  await c.end();
  process.exit(0);
}

const del = await c.query(`
  DELETE FROM photos ph
  WHERE ph.source_url ~* 'cars2?\\.import-motor\\.com'
    AND EXISTS (
      SELECT 1 FROM photos a
      WHERE a.listing_id = ph.listing_id
        AND (
          a.source_url ~* 'vis\\.iaai\\.com/resizer'
          OR a.source_url ~* 'cs\\.copart\\.com'
          OR a.source_url ~* 'ci\\.encar\\.com'
        )
    )
`);
console.log("deleted", del.rowCount);

const after = await c.query(countSql);
console.log("remaining", after.rows[0].n);
await c.end();
