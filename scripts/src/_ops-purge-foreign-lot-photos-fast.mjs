import fs from "node:fs";
import pg from "pg";

const useProd = process.argv.includes("--prod");
const onlyVin = process.argv.find((a) => a.startsWith("--vin="))?.split("=")[1];

function client() {
  if (!useProd) return new pg.Client({ connectionString: process.env.DATABASE_URL });
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return new pg.Client({
    host: get("RAILWAY_TCP_PROXY_DOMAIN"),
    port: Number(get("RAILWAY_TCP_PROXY_PORT") || 5432),
    user: get("PGUSER") || "postgres",
    password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
    database: get("PGDATABASE") || "railway",
    ssl: false,
  });
}

const c = client();
await c.connect();
const params = [];
let vinSql = "";
if (onlyVin) {
  params.push(onlyVin);
  vinSql = `AND v.vin = $${params.length}`;
}

const del = await c.query(
  `
  WITH candidates AS (
    SELECT ph.id,
           ph.source_url,
           regexp_replace(split_part(regexp_replace(l.source_id, '^im-', '', 'i'), '-', 1), '[^0-9]', '', 'g') AS pin,
           (regexp_match(ph.source_url, '/([0-9]{6,})-[0-9]{0,3}[A-Za-z]?\\.(?:jpe?g|webp|png)', 'i'))[1] AS url_lot,
           (regexp_match(ph.source_url, 'partitionKey=([0-9]{6,})', 'i'))[1] AS spin_lot,
           coalesce(ph.photo_group, 'gallery') AS grp
    FROM photos ph
    JOIN listings l ON l.id = ph.listing_id
    JOIN providers p ON p.id = l.provider_id
    JOIN vehicles v ON v.id = ph.vehicle_id
    WHERE p.internal_name IN ('salvagebid', 'import_motor', 'iaa', 'copart', 'bidscan', 'bidcars')
      AND (
        ph.source_url ILIKE '%vehimg%'
        OR ph.source_url ILIKE '%ThreeSixtyImageRetriever%'
        OR ph.source_url ILIKE '%partitionKey=%'
        OR ph.source_url ILIKE 'data:image/gif%'
      )
      ${vinSql}
  ),
  doomed AS (
    SELECT id FROM candidates
    WHERE source_url ILIKE 'data:image/gif%'
       OR (url_lot IS NOT NULL AND pin ~ '^[0-9]{6,}$' AND url_lot <> pin)
       OR (
            grp = 'exterior_3d'
            AND spin_lot IS NOT NULL
            AND pin ~ '^[0-9]{6,}$'
            AND spin_lot <> pin
          )
  )
  DELETE FROM photos ph USING doomed d WHERE ph.id = d.id
  RETURNING ph.id
  `,
  params,
);

let remaining = null;
if (onlyVin) {
  remaining = (
    await c.query(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE coalesce(photo_group,'gallery')='exterior_3d')::int AS spins,
              array_agg(DISTINCT left(source_url, 90)) FILTER (WHERE source_url ILIKE '%vehimg%') AS sample
       FROM photos ph JOIN vehicles v ON v.id = ph.vehicle_id WHERE v.vin = $1`,
      [onlyVin],
    )
  ).rows[0];
}

console.log(JSON.stringify({ target: useProd ? "prod" : "local", onlyVin: onlyVin || null, deleted: del.rowCount, remaining }, null, 2));
await c.end();
