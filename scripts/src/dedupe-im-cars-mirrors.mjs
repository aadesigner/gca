/**
 * Drop cars*.import-motor mirrors when the same IM listing already has auction CDN frames.
 * Safe local cleanup when live re-fetch fails (CF) but duplicates are already in DB.
 */
await import("../load-env.mjs");
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");
const vinFilter = process.argv.find((a, i) => process.argv[i - 1] === "--vin")?.toUpperCase();
const dryRun = process.argv.includes("--dry-run");

const c = new pg.Client({ connectionString: url });
await c.connect();

const params = [];
let vinSql = "";
if (vinFilter) {
  params.push(vinFilter);
  vinSql = `AND v.vin = $1`;
}

const candidates = await c.query(
  `
  SELECT l.id AS listing_id, v.vin,
    count(*) FILTER (WHERE ph.source_url ~* 'cars2?\\.import-motor\\.com') AS cars_n,
    count(*) FILTER (
      WHERE ph.source_url ~* 'vis\\.iaai\\.com/resizer'
         OR ph.source_url ~* 'cs\\.copart\\.com'
         OR ph.source_url ~* 'ci\\.encar\\.com'
    ) AS auction_n
  FROM listings l
  JOIN vehicles v ON v.id = l.vehicle_id
  JOIN photos ph ON ph.listing_id = l.id
  WHERE (l.source_id LIKE 'im-%' OR l.source_url ILIKE '%import-motor.com/v/%')
    ${vinSql}
  GROUP BY l.id, v.vin
  HAVING count(*) FILTER (WHERE ph.source_url ~* 'cars2?\\.import-motor\\.com') > 0
     AND count(*) FILTER (
           WHERE ph.source_url ~* 'vis\\.iaai\\.com/resizer'
              OR ph.source_url ~* 'cs\\.copart\\.com'
              OR ph.source_url ~* 'ci\\.encar\\.com'
         ) > 0
  ORDER BY l.id DESC
  LIMIT 10000
  `,
  params,
);

console.log("dup listings", candidates.rows.length);
if (dryRun) {
  candidates.rows.slice(0, 30).forEach((r) => console.log(r));
  await c.end();
  process.exit(0);
}

let deleted = 0;
for (const row of candidates.rows) {
  const res = await c.query(
    `
    DELETE FROM photos
    WHERE listing_id = $1
      AND source_url ~* 'cars2?\\.import-motor\\.com'
    RETURNING id
    `,
    [row.listing_id],
  );
  deleted += res.rowCount ?? 0;
  console.log(row.vin, "listing", row.listing_id, "removed cars mirrors", res.rowCount);
}

console.log("Done. deleted", deleted, "from", candidates.rows.length, "listings");
await c.end();
