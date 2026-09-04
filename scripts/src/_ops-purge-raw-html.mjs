/**
 * Audit (and optionally purge) HTML-looking rows in raw_source_records.
 * Usage:
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-purge-raw-html.mjs --local
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-purge-raw-html.mjs --prod --dry-run
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-purge-raw-html.mjs --prod --apply
 */
import pg from "pg";

const args = new Set(process.argv.slice(2));
const useProd = args.has("--prod");
const useLocal = args.has("--local") || !useProd;
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;

function client() {
  if (useProd) {
    const password = process.env.PROD_PG_PASSWORD || process.env.PGPASSWORD;
    if (!password) throw new Error("Set PROD_PG_PASSWORD or PGPASSWORD");
    return new pg.Client({
      host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
      port: Number(process.env.PROD_PG_PORT || "15622"),
      user: process.env.PROD_PG_USER || "postgres",
      password,
      database: process.env.PROD_PG_DATABASE || "railway",
      ssl: false,
      connectionTimeoutMillis: 20_000,
    });
  }
  return new pg.Client({
    connectionString: process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL,
  });
}

const HTML_WHERE = `
  raw_json IS NOT NULL
  AND btrim(raw_json) <> ''
  AND (
    left(ltrim(raw_json), 1) NOT IN ('{', '[')
    OR raw_json ~* '<(!DOCTYPE|html|head|body)[[:space:]>]'
  )
`;

const c = client();
await c.connect();
console.log(`Target: ${useProd ? "PROD" : "LOCAL"} mode=${dryRun ? "DRY-RUN" : "APPLY"}`);

const col = await c.query(`
  SELECT 1 AS ok
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'raw_source_records'
    AND column_name = 'raw_html'
  LIMIT 1
`);
console.log("raw_html column present:", col.rowCount > 0);

const count = await c.query(`SELECT count(*)::int AS c FROM raw_source_records WHERE ${HTML_WHERE}`);
console.log("HTML-looking raw_json rows:", count.rows[0].c);

const sample = await c.query(`
  SELECT id, provider_id, source_id, length(raw_json) AS bytes, left(ltrim(raw_json), 80) AS head
  FROM raw_source_records
  WHERE ${HTML_WHERE}
  ORDER BY id DESC
  LIMIT 5
`);
for (const r of sample.rows) {
  console.log(" sample", r);
}

if (!dryRun && count.rows[0].c > 0) {
  const del = await c.query(`DELETE FROM raw_source_records WHERE ${HTML_WHERE}`);
  console.log("Deleted rows:", del.rowCount);
}

if (!dryRun && col.rowCount > 0) {
  await c.query(`ALTER TABLE raw_source_records DROP COLUMN IF EXISTS raw_html`);
  console.log("Dropped raw_html column");
}

await c.end();
