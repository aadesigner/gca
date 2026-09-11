/**
 * Remap recent import-motor.com listings onto import_motor (local + prod).
 * Default window: 14 days (avoids rewriting 500k+ historic Copart collisions).
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-remap-im-provider.mjs
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-remap-im-provider.mjs --since=7d
 */
import fs from "node:fs";
import pg from "pg";

const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.split("=")[1] ?? "14d";
const m = sinceArg.match(/^(\d+)(d|h)$/);
if (!m) {
  console.error("--since must look like 14d or 48h");
  process.exit(1);
}
const sinceInterval = `${m[1]} ${m[2] === "d" ? "days" : "hours"}`;

async function remap(label, client) {
  const im = await client.query(`SELECT id FROM providers WHERE internal_name='import_motor'`);
  const imId = im.rows[0]?.id;
  if (!imId) {
    console.log(label, "no import_motor provider");
    return;
  }

  const before = await client.query(
    `
    SELECT p.internal_name, count(*)::int AS n
    FROM listings l JOIN providers p ON p.id=l.provider_id
    WHERE l.source_url ILIKE '%import-motor.com%'
      AND l.created_at > now() - $1::interval
    GROUP BY 1 ORDER BY n DESC`,
    [sinceInterval],
  );
  console.log(label, "before", before.rows);

  const upd1 = await client.query(
    `
    UPDATE listings l
    SET provider_id = $1, updated_at = NOW()
    FROM (
      SELECT DISTINCT ON (source_id) id, source_id
      FROM listings
      WHERE source_url ILIKE '%import-motor.com%'
        AND provider_id <> $1
        AND created_at > now() - $2::interval
      ORDER BY source_id, id ASC
    ) pick
    WHERE l.id = pick.id
      AND NOT EXISTS (
        SELECT 1 FROM listings x
        WHERE x.provider_id = $1
          AND x.source_id = pick.source_id
      )
    `,
    [imId, sinceInterval],
  );
  console.log(label, "remapped_unique", upd1.rowCount);

  const del = await client.query(
    `
    DELETE FROM listings l
    WHERE l.source_url ILIKE '%import-motor.com%'
      AND l.provider_id <> $1
      AND l.created_at > now() - $2::interval
      AND EXISTS (
        SELECT 1 FROM listings x
        WHERE x.provider_id = $1
          AND x.source_id = l.source_id
      )
    `,
    [imId, sinceInterval],
  );
  console.log(label, "deleted_dupes", del.rowCount);

  const upd2 = await client.query(
    `
    UPDATE listings
    SET source_id = source_id || '-im' || id::text,
        provider_id = $1,
        updated_at = NOW()
    WHERE source_url ILIKE '%import-motor.com%'
      AND provider_id <> $1
      AND created_at > now() - $2::interval
    `,
    [imId, sinceInterval],
  );
  console.log(label, "forced_unique_sid", upd2.rowCount);

  const after = await client.query(
    `
    SELECT p.internal_name, count(*)::int AS n
    FROM listings l JOIN providers p ON p.id=l.provider_id
    WHERE l.source_url ILIKE '%import-motor.com%'
      AND l.created_at > now() - $1::interval
    GROUP BY 1 ORDER BY n DESC`,
    [sinceInterval],
  );
  console.log(label, "after", after.rows);
}

console.log("since", sinceInterval);

const local = new pg.Client({ connectionString: process.env.DATABASE_URL });
await local.connect();
await remap("local", local);
await local.end();

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
const url = `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
const prod = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0,
});
await prod.connect();
await remap("prod", prod);
await prod.end();
