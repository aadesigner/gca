/**
 * Delete ALL interior_3d photo rows from prod and/or local.
 * Usage:
 *   TARGET=prod node scripts/src/_tmp-purge-all-interior-360.mjs
 *   TARGET=local node scripts/src/_tmp-purge-all-interior-360.mjs
 *   TARGET=both node scripts/src/_tmp-purge-all-interior-360.mjs
 */
import fs from "node:fs";
import pg from "pg";

const TARGET = (process.env.TARGET || "both").toLowerCase();

function clientFromTemp(file) {
  const raw = fs.readFileSync(`${process.env.TEMP}/${file}`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => {
    const v = vars[n];
    return v && typeof v === "object" && "value" in v ? v.value : v;
  };
  const host = get("RAILWAY_TCP_PROXY_DOMAIN") || get("PGHOST");
  const port = Number(get("RAILWAY_TCP_PROXY_PORT") || get("PGPORT") || 5432);
  return new pg.Client({
    host,
    port,
    user: get("PGUSER") || "postgres",
    password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
    database: get("PGDATABASE") || "railway",
    ssl: host && !/localhost|127\.0\.0\.1/i.test(String(host)) ? { rejectUnauthorized: false } : undefined,
  });
}

async function purge(label, file) {
  const c = clientFromTemp(file);
  await c.connect();
  await c.query("SET max_parallel_workers_per_gather = 0");
  const before = await c.query(
    `SELECT count(*)::int n FROM photos WHERE photo_group = 'interior_3d'`,
  );
  console.log(label, "before", before.rows[0].n);
  let total = 0;
  for (;;) {
    const del = await c.query(`
      DELETE FROM photos
      WHERE id IN (
        SELECT id FROM photos WHERE photo_group = 'interior_3d' LIMIT 5000
      )
      RETURNING id
    `);
    total += del.rowCount;
    console.log(label, "batch", del.rowCount, "total", total);
    if (del.rowCount === 0) break;
  }
  // Also wipe InteriorImageRetriever URLs mis-tagged as gallery/exterior
  const mis = await c.query(`
    DELETE FROM photos
    WHERE source_url ILIKE '%InteriorImageRetriever%'
    RETURNING id
  `);
  console.log(label, "misTaggedInteriorRetriever", mis.rowCount);
  const after = await c.query(
    `SELECT count(*)::int n FROM photos WHERE photo_group = 'interior_3d'`,
  );
  console.log(label, "after", after.rows[0].n, "purged", total);
  await c.end();
}

if (TARGET === "prod" || TARGET === "both") {
  await purge("prod", "gca-pg-vars-prod.json");
}
if (TARGET === "local" || TARGET === "both") {
  try {
    await purge("local", "gca-pg-vars.json");
  } catch (e) {
    console.error("local purge failed", e.message);
  }
}
