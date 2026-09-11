/**
 * Mark dead BidExport IAAI photos so mirror can drain (bare resizer + known-dead).
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-mark-dead-bidexport-photos.mjs
 */
import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const c = new pg.Client({
  connectionString: loadProdUrl(),
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0,
});
await c.connect();

const bare = await c.query(`
  UPDATE photos ph
  SET stored_path = 'mirror-failed:' || ph.id::text
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE l.id = ph.listing_id
    AND p.internal_name = 'bidexport'
    AND ph.stored_path IS NULL
    AND (
      ph.source_url ~* 'vis\\.iaai\\.com/resizer' AND ph.source_url !~* '[?&]imageKeys='
      OR ph.source_url ~* 'vis\\.iaai\\.com/resizer\\s*$'
    )
`);
console.log("marked_bare", bare.rowCount);

// Probe a sample of oldest pending IAAI URLs; mark 404/500 as dead.
const pending = await c.query(`
  SELECT ph.id, ph.source_url
  FROM photos ph
  JOIN listings l ON l.id = ph.listing_id
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'bidexport'
    AND ph.stored_path IS NULL
    AND ph.source_url ILIKE '%vis.iaai.com%'
  ORDER BY ph.id ASC
  LIMIT 200
`);

let dead = 0;
let ok = 0;
const deadIds = [];
for (const row of pending.rows) {
  try {
    const res = await fetch(row.source_url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Referer: "https://www.iaai.com/",
        Accept: "image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    if (res.status === 404 || res.status === 410 || res.status === 500 || res.status === 502 || res.status === 503) {
      deadIds.push(row.id);
      dead += 1;
    } else if (res.ok) {
      ok += 1;
      await res.arrayBuffer();
    } else {
      deadIds.push(row.id);
      dead += 1;
    }
  } catch {
    deadIds.push(row.id);
    dead += 1;
  }
}
if (deadIds.length) {
  const r = await c.query(
    `UPDATE photos SET stored_path = 'mirror-failed:' || id::text WHERE id = ANY($1::int[]) AND stored_path IS NULL`,
    [deadIds],
  );
  console.log("marked_probed_dead", r.rowCount, { probed: pending.rows.length, ok, dead });
} else {
  console.log("probed", { probed: pending.rows.length, ok, dead });
}

const stats = await c.query(`
  SELECT
    count(*) FILTER (WHERE ph.stored_path IS NULL AND ph.source_url ILIKE 'http%')::int AS pending,
    count(*) FILTER (WHERE ph.stored_path ~* 'imgsv|r2\\.dev')::int AS mirrored,
    count(*) FILTER (WHERE ph.stored_path ILIKE 'mirror-failed%')::int AS failed
  FROM photos ph
  JOIN listings l ON l.id = ph.listing_id
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'bidexport'
`);
console.log("stats", stats.rows[0]);
await c.end();
