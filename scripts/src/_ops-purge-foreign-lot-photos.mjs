/**
 * Delete gallery/360 frames whose URL lot id ≠ listings.source_id lot.
 * Fixes Salvagebid similar-lot thumbs and related-car IAA 360 pollution.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-purge-foreign-lot-photos.mjs
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-purge-foreign-lot-photos.mjs --prod
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-purge-foreign-lot-photos.mjs --vin=1FA6P8CF5K5120103
 */
import fs from "node:fs";
import pg from "pg";

const useProd = process.argv.includes("--prod");
const onlyVin = process.argv.find((a) => a.startsWith("--vin="))?.split("=")[1];

function loadClient() {
  if (!useProd) {
    return new pg.Client({ connectionString: process.env.DATABASE_URL });
  }
  if (process.env.PROD_DATABASE_URL) {
    return new pg.Client({
      connectionString: process.env.PROD_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) =>
    vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n];
  return new pg.Client({
    host: process.env.PROD_PG_HOST ?? get("RAILWAY_TCP_PROXY_DOMAIN"),
    port: Number(process.env.PROD_PG_PORT ?? get("RAILWAY_TCP_PROXY_PORT") ?? 5432),
    user: process.env.PROD_PG_USER ?? get("PGUSER") ?? "postgres",
    password: process.env.PROD_PG_PASSWORD ?? get("PGPASSWORD") ?? get("POSTGRES_PASSWORD"),
    database: process.env.PROD_PG_DATABASE ?? get("PGDATABASE") ?? "railway",
    ssl: false,
  });
}

const c = loadClient();
await c.connect();

const vinClause = onlyVin ? `AND v.vin = $1` : "";
const params = onlyVin ? [onlyVin] : [];

// Salvagebid / vehimg: filename stock ≠ listing stock
const vehimg = await c.query(
  `
  WITH doomed AS (
    SELECT ph.id
    FROM photos ph
    JOIN listings l ON l.id = ph.listing_id
    JOIN vehicles v ON v.id = ph.vehicle_id
    WHERE ph.source_url ~* 'vehimg|/amazonaws\\.com/'
      AND (
        regexp_match(
          ph.source_url,
          '/([0-9]{6,})-[0-9]{0,3}[A-Za-z]?\\.(?:jpe?g|webp|png)',
          'i'
        )
      )[1] IS NOT NULL
      AND (
        regexp_match(
          ph.source_url,
          '/([0-9]{6,})-[0-9]{0,3}[A-Za-z]?\\.(?:jpe?g|webp|png)',
          'i'
        )
      )[1] <> regexp_replace(split_part(regexp_replace(l.source_id, '^im-', '', 'i'), '-', 1), '[^0-9]', '', 'g')
      ${vinClause}
  )
  DELETE FROM photos ph
  USING doomed d
  WHERE ph.id = d.id
  RETURNING ph.id
  `,
  params,
);

// IAA 360 partitionKey ≠ listing stock (and no matching gallery stills for that stock)
const spins = await c.query(
  `
  WITH doomed AS (
    SELECT ph.id
    FROM photos ph
    JOIN listings l ON l.id = ph.listing_id
    JOIN vehicles v ON v.id = ph.vehicle_id
    WHERE coalesce(ph.photo_group, 'gallery') = 'exterior_3d'
      AND ph.source_url ~* 'ThreeSixtyImageRetriever|partitionKey=|~SID~STP~|%7ESID%7ESTP%7E'
      AND (
        regexp_match(ph.source_url, 'partitionKey=([0-9]{6,})', 'i')
      )[1] IS NOT NULL
      AND (
        regexp_match(ph.source_url, 'partitionKey=([0-9]{6,})', 'i')
      )[1] <> regexp_replace(split_part(regexp_replace(l.source_id, '^im-', '', 'i'), '-', 1), '[^0-9]', '', 'g')
      AND NOT EXISTS (
        SELECT 1 FROM photos g
        WHERE g.listing_id = ph.listing_id
          AND coalesce(g.photo_group, 'gallery') = 'gallery'
          AND g.source_url ~* 'vis\\.iaai\\.com|mediaretriever\\.iaai\\.com'
          AND g.source_url LIKE '%' || (regexp_match(ph.source_url, 'partitionKey=([0-9]{6,})', 'i'))[1] || '%'
      )
      ${vinClause}
  )
  DELETE FROM photos ph
  USING doomed d
  WHERE ph.id = d.id
  RETURNING ph.id
  `,
  params,
);

// Tiny GIF placeholders
const gifs = await c.query(
  `
  WITH doomed AS (
    SELECT ph.id
    FROM photos ph
    JOIN vehicles v ON v.id = ph.vehicle_id
    WHERE ph.source_url ~* '^data:image/gif'
      ${vinClause}
  )
  DELETE FROM photos ph
  USING doomed d
  WHERE ph.id = d.id
  RETURNING ph.id
  `,
  params,
);

const check = onlyVin
  ? (
      await c.query(
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE coalesce(photo_group,'gallery')='exterior_3d')::int AS spins,
                count(*) FILTER (WHERE source_url ~* 'vehimg')::int AS vehimg
         FROM photos ph JOIN vehicles v ON v.id=ph.vehicle_id WHERE v.vin=$1`,
        [onlyVin],
      )
    ).rows[0]
  : null;

console.log(
  JSON.stringify(
    {
      target: useProd ? "prod" : "local",
      onlyVin: onlyVin || null,
      deletedVehimg: vehimg.rowCount,
      deletedSpins: spins.rowCount,
      deletedGifs: gifs.rowCount,
      remaining: check,
    },
    null,
    2,
  ),
);

await c.end();
