/**
 * Purge IAAI 360 frames wrongly attached to Copart galleries.
 * Copart lot numbers collide with IAAI stock IDs — never trust them as spin keys.
 *
 * Safety:
 * - Deletes ONLY photo_group exterior_3d / interior_3d
 * - Requires listing gallery to look Copart (path or cs.copart.com)
 * - Requires NO IAA gallery frames on the same listing
 * - Spin URL must be IAA (vis.iaai / mediaretriever)
 * - Does NOT filter by provider name (leftovers live under copart + import_motor)
 * - Does NOT touch gallery rows
 *
 *   DRY_RUN=1 node ./scripts/src/_tmp-purge-copart-iaai-360-mix.mjs
 *   node ./scripts/src/_tmp-purge-copart-iaai-360-mix.mjs
 *   VIN=... DRY_RUN=1 node ./scripts/src/_tmp-purge-copart-iaai-360-mix.mjs
 */
import fs from "node:fs";
import pg from "pg";

const DRY = process.env.DRY_RUN === "1";
const VIN = process.env.VIN || null;
const BATCH = Math.max(500, Number(process.env.BATCH || 5000));

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => {
  const v = vars[n];
  return v && typeof v === "object" && "value" in v ? v.value : v;
};

const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || get("POSTGRES_USER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 60000,
});
await c.connect();

/** Shared predicate: bad Copart-gallery + IAA-spin on same listing. */
const WHERE_BAD = `
  p.photo_group IN ('exterior_3d', 'interior_3d')
  AND (
    COALESCE(p.source_url, '') ILIKE '%vis.iaai.com%'
    OR COALESCE(p.source_url, '') ILIKE '%mediaretriever.iaai.com%'
    OR COALESCE(p.stored_path, '') ILIKE '%vis.iaai.com%'
    OR COALESCE(p.stored_path, '') ILIKE '%mediaretriever.iaai.com%'
  )
  AND EXISTS (
    SELECT 1 FROM photos g
    WHERE g.listing_id = l.id
      AND g.photo_group = 'gallery'
      AND (
        COALESCE(g.source_url, g.stored_path, '') ILIKE '%/copart/%'
        OR COALESCE(g.source_url, g.stored_path, '') ILIKE '%cs.copart.com%'
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM photos g2
    WHERE g2.listing_id = l.id
      AND g2.photo_group = 'gallery'
      AND (
        COALESCE(g2.source_url, g2.stored_path, '') ILIKE '%/iaai/%'
        OR COALESCE(g2.source_url, g2.stored_path, '') ILIKE '%vis.iaai.com%'
        OR COALESCE(g2.source_url, g2.stored_path, '') ILIKE '%mediaretriever.iaai.com%'
      )
  )
  AND ($1::text IS NULL OR v.vin = $1)
`;

const protectVins = [
  "WP0AB2A92TS227786",
  "WP1AB2A53HLB11672",
  "WP1AA2A56PLB03986",
  "JHMGE87289S000169",
];

async function countBad() {
  const r = await c.query(
    `
    SELECT count(*)::int AS frames,
           count(DISTINCT p.vehicle_id)::int AS vehicles,
           count(DISTINCT p.listing_id)::int AS listings
    FROM photos p
    JOIN listings l ON l.id = p.listing_id
    JOIN vehicles v ON v.id = p.vehicle_id
    WHERE ${WHERE_BAD}
    `,
    [VIN],
  );
  return r.rows[0];
}

async function protectCounts() {
  const r = await c.query(
    `
    SELECT v.vin,
           count(*) FILTER (WHERE p.photo_group='gallery')::int AS gal,
           count(*) FILTER (WHERE p.photo_group='exterior_3d')::int AS ext,
           count(*) FILTER (WHERE p.photo_group='interior_3d')::int AS int
    FROM vehicles v
    JOIN photos p ON p.vehicle_id = v.id
    WHERE v.vin = ANY($1::text[])
    GROUP BY v.vin
    ORDER BY v.vin
    `,
    [protectVins],
  );
  return r.rows;
}

const before = await countBad();
const protectBefore = await protectCounts();
console.log({ dry: DRY, vin: VIN, before, protectBefore });

const samples = await c.query(
  `
  SELECT v.vin, pr.internal_name AS provider, l.id AS listing_id,
         count(*) FILTER (WHERE p.photo_group='exterior_3d')::int AS ext,
         count(*) FILTER (WHERE p.photo_group='interior_3d')::int AS int,
         min(left(p.source_url, 100)) FILTER (WHERE p.photo_group='exterior_3d') AS sample_spin,
         (
           SELECT left(g.source_url, 100) FROM photos g
           WHERE g.listing_id = l.id AND g.photo_group='gallery'
           ORDER BY g.sort_order LIMIT 1
         ) AS sample_gallery
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = p.vehicle_id
  WHERE ${WHERE_BAD}
  GROUP BY v.vin, pr.internal_name, l.id
  ORDER BY (count(*)) DESC
  LIMIT 8
  `,
  [VIN],
);
console.log("samples", samples.rows);

if (DRY) {
  console.log("DRY_RUN — no deletes");
  await c.end();
  process.exit(0);
}

let deletedTotal = 0;
while (true) {
  const del = await c.query(
    `
    WITH doomed AS (
      SELECT p.id
      FROM photos p
      JOIN listings l ON l.id = p.listing_id
      JOIN vehicles v ON v.id = p.vehicle_id
      WHERE ${WHERE_BAD}
      LIMIT $2
    )
    DELETE FROM photos p
    USING doomed d
    WHERE p.id = d.id
    RETURNING p.id
    `,
    [VIN, BATCH],
  );
  deletedTotal += del.rowCount;
  console.log({ batchDeleted: del.rowCount, deletedTotal });
  if (del.rowCount === 0) break;
}

const after = await countBad();
const protectAfter = await protectCounts();
console.log({ after, deletedTotal, protectAfter });

// Ensure protected clean IAA VINs did not lose spin frames
for (const beforeRow of protectBefore) {
  const afterRow = protectAfter.find((r) => r.vin === beforeRow.vin);
  if (!afterRow) {
    console.error("PROTECT FAIL missing vin", beforeRow.vin);
    process.exitCode = 2;
    continue;
  }
  if (afterRow.ext < beforeRow.ext || afterRow.int < beforeRow.int || afterRow.gal < beforeRow.gal) {
    console.error("PROTECT FAIL counts dropped", { beforeRow, afterRow });
    process.exitCode = 2;
  }
}

if (after.frames !== 0) {
  console.error("leftover bad frames remain", after);
  process.exitCode = 1;
}

await c.end();
