/**
 * Append ?fl=exf to raw Seznam SDN sauto photo URLs so browsers / mirror can fetch them.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-sauto-fix-sdn-urls.mjs
 *   DRY_RUN=1 ...
 */
import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const dry = process.env.DRY_RUN === "1";
const c = new pg.Client({ connectionString: loadProdUrl(), ssl: { rejectUnauthorized: false }, statement_timeout: 0 });
await c.connect();

const before = await c.query(`
SELECT count(*)::int AS n
FROM photos ph
JOIN listings l ON l.id = ph.listing_id
JOIN providers p ON p.id = l.provider_id
WHERE p.internal_name = 'sauto'
  AND ph.source_url ~* 'sdn\\.cz'
  AND ph.source_url !~* '[?&]fl='
`);
console.log("need_fix", before.rows[0]);

const sample = await c.query(`
SELECT ph.id, left(ph.source_url,100) AS src
FROM photos ph
JOIN listings l ON l.id = ph.listing_id
JOIN providers p ON p.id = l.provider_id
WHERE p.internal_name = 'sauto'
  AND ph.source_url ~* 'sdn\\.cz'
  AND ph.source_url !~* '[?&]fl='
ORDER BY ph.id DESC
LIMIT 3
`);
console.log("sample_before", sample.rows);

if (!dry) {
  const upd = await c.query(`
UPDATE photos ph
SET source_url = ph.source_url || CASE WHEN ph.source_url LIKE '%?%' THEN '&fl=exf' ELSE '?fl=exf' END
FROM listings l
JOIN providers p ON p.id = l.provider_id
WHERE ph.listing_id = l.id
  AND p.internal_name = 'sauto'
  AND ph.source_url ~* 'sdn\\.cz'
  AND ph.source_url !~* '[?&]fl='
`);
  console.log("updated", upd.rowCount);
}

const after = await c.query(`
SELECT
  count(*)::int AS photos,
  count(*) FILTER (WHERE source_url ~* '[?&]fl=')::int AS with_fl,
  count(*) FILTER (WHERE stored_path IS NOT NULL AND btrim(stored_path) <> '')::int AS stored
FROM photos ph
JOIN listings l ON l.id = ph.listing_id
JOIN providers p ON p.id = l.provider_id
WHERE p.internal_name = 'sauto'
`);
console.log("after", after.rows[0]);
await c.end();
