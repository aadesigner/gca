/**
 * Fast set-based purge of multi-stock IAA 360 mixes + STP/retriever exterior dups.
 *
 *   DRY_RUN=1 node ./scripts/src/_tmp-purge-multistock-360.mjs
 *   node ./scripts/src/_tmp-purge-multistock-360.mjs
 *   VIN=WP0AB2A92TS227786 node ./scripts/src/_tmp-purge-multistock-360.mjs
 */
import fs from "node:fs";
import pg from "pg";

const DRY = process.env.DRY_RUN === "1";
const VIN = process.env.VIN || null;

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
await c.query("SET statement_timeout = '0'");

const stockExpr = (col) => `
  COALESCE(
    (regexp_match(${col}, 'partitionKey=(\\d{6,})', 'i'))[1],
    (regexp_match(${col}, 'imageKeys=(\\d{6,})(?:%7E|~)SID', 'i'))[1],
    (regexp_match(${col}, '/iaai/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
  )
`;

console.log({ dry: DRY, vin: VIN });

// Canonical stock per listing: majority gallery /iaai/ path, else source_id
const countSql = `
WITH gal AS (
  SELECT p.listing_id,
         ${stockExpr("p.source_url")} AS stock,
         count(*)::int AS n
  FROM photos p
  WHERE p.photo_group = 'gallery'
    AND p.listing_id IS NOT NULL
    AND COALESCE(p.source_url,'') NOT ILIKE '%/copart/%'
    AND COALESCE(p.source_url,'') NOT ILIKE '%cs.copart.com%'
    AND ${stockExpr("p.source_url")} IS NOT NULL
  GROUP BY 1, 2
),
ranked AS (
  SELECT listing_id, stock, n,
         row_number() OVER (PARTITION BY listing_id ORDER BY n DESC, stock) AS rn
  FROM gal
),
canon AS (
  SELECT l.id AS listing_id,
         COALESCE(
           (SELECT stock FROM ranked r WHERE r.listing_id = l.id AND r.rn = 1),
           NULLIF(regexp_replace(COALESCE(l.source_id,''), '^im-', 'i'), '')
         ) AS stock
  FROM listings l
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE ($1::text IS NULL OR v.vin = $1)
),
foreign_spin AS (
  SELECT p.id, v.vin, c.stock AS keep_stock, ${stockExpr("p.source_url")} AS bad_stock, p.photo_group
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN vehicles v ON v.id = p.vehicle_id
  JOIN canon c ON c.listing_id = l.id
  WHERE p.photo_group IN ('exterior_3d','interior_3d')
    AND c.stock ~ '^[0-9]{6,}$'
    AND ${stockExpr("p.source_url")} IS NOT NULL
    AND ${stockExpr("p.source_url")} <> c.stock
),
stp_dup AS (
  SELECT p.id, v.vin, c.stock, p.photo_group
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN vehicles v ON v.id = p.vehicle_id
  JOIN canon c ON c.listing_id = l.id
  WHERE p.photo_group = 'exterior_3d'
    AND c.stock ~ '^[0-9]{6,}$'
    AND ${stockExpr("p.source_url")} = c.stock
    AND p.source_url ILIKE '%vis.iaai.com/resizer%'
    AND p.source_url ~* '(~|%7E)STP(~|%7E)'
    AND EXISTS (
      SELECT 1 FROM photos r
      WHERE r.listing_id = p.listing_id
        AND r.photo_group = 'exterior_3d'
        AND ${stockExpr("r.source_url")} = c.stock
        AND r.source_url ILIKE '%ThreeSixtyImageRetriever%'
    )
)
SELECT
  (SELECT count(*)::int FROM foreign_spin) AS foreign_frames,
  (SELECT count(DISTINCT vin) FROM foreign_spin) AS foreign_vins,
  (SELECT count(*)::int FROM stp_dup) AS stp_dup_frames,
  (SELECT count(DISTINCT vin) FROM stp_dup) AS stp_dup_vins
`;

const before = await c.query(countSql, [VIN]);
console.log("before", before.rows[0]);

const sampleForeign = await c.query(
  `
WITH gal AS (
  SELECT p.listing_id, ${stockExpr("p.source_url")} AS stock, count(*)::int AS n
  FROM photos p
  WHERE p.photo_group = 'gallery'
    AND p.listing_id IS NOT NULL
    AND COALESCE(p.source_url,'') NOT ILIKE '%/copart/%'
    AND ${stockExpr("p.source_url")} IS NOT NULL
  GROUP BY 1,2
),
ranked AS (
  SELECT listing_id, stock, row_number() OVER (PARTITION BY listing_id ORDER BY n DESC, stock) rn
  FROM gal
),
canon AS (
  SELECT l.id AS listing_id,
         COALESCE(
           (SELECT stock FROM ranked r WHERE r.listing_id = l.id AND r.rn = 1),
           NULLIF(regexp_replace(COALESCE(l.source_id,''), '^im-', 'i'), '')
         ) AS stock
  FROM listings l
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE ($1::text IS NULL OR v.vin = $1)
)
SELECT v.vin, c.stock AS keep, ${stockExpr("p.source_url")} AS bad, p.photo_group, count(*)::int n
FROM photos p
JOIN listings l ON l.id = p.listing_id
JOIN vehicles v ON v.id = p.vehicle_id
JOIN canon c ON c.listing_id = l.id
WHERE p.photo_group IN ('exterior_3d','interior_3d')
  AND c.stock ~ '^[0-9]{6,}$'
  AND ${stockExpr("p.source_url")} IS NOT NULL
  AND ${stockExpr("p.source_url")} <> c.stock
GROUP BY 1,2,3,4
ORDER BY n DESC
LIMIT 10
`,
  [VIN],
);
console.log("sampleForeign", sampleForeign.rows);

if (DRY) {
  console.log("DRY_RUN — no deletes");
  await c.end();
  process.exit(0);
}

const delForeign = await c.query(
  `
WITH gal AS (
  SELECT p.listing_id, ${stockExpr("p.source_url")} AS stock, count(*)::int AS n
  FROM photos p
  WHERE p.photo_group = 'gallery'
    AND p.listing_id IS NOT NULL
    AND COALESCE(p.source_url,'') NOT ILIKE '%/copart/%'
    AND COALESCE(p.source_url,'') NOT ILIKE '%cs.copart.com%'
    AND ${stockExpr("p.source_url")} IS NOT NULL
  GROUP BY 1,2
),
ranked AS (
  SELECT listing_id, stock, row_number() OVER (PARTITION BY listing_id ORDER BY n DESC, stock) rn
  FROM gal
),
canon AS (
  SELECT l.id AS listing_id,
         COALESCE(
           (SELECT stock FROM ranked r WHERE r.listing_id = l.id AND r.rn = 1),
           NULLIF(regexp_replace(COALESCE(l.source_id,''), '^im-', 'i'), '')
         ) AS stock
  FROM listings l
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE ($1::text IS NULL OR v.vin = $1)
),
doomed AS (
  SELECT p.id
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN canon c ON c.listing_id = l.id
  WHERE p.photo_group IN ('exterior_3d','interior_3d')
    AND c.stock ~ '^[0-9]{6,}$'
    AND ${stockExpr("p.source_url")} IS NOT NULL
    AND ${stockExpr("p.source_url")} <> c.stock
)
DELETE FROM photos p USING doomed d WHERE p.id = d.id
RETURNING p.id
`,
  [VIN],
);
console.log("deletedForeign", delForeign.rowCount);

const delStp = await c.query(
  `
WITH gal AS (
  SELECT p.listing_id, ${stockExpr("p.source_url")} AS stock, count(*)::int AS n
  FROM photos p
  WHERE p.photo_group = 'gallery'
    AND p.listing_id IS NOT NULL
    AND COALESCE(p.source_url,'') NOT ILIKE '%/copart/%'
    AND COALESCE(p.source_url,'') NOT ILIKE '%cs.copart.com%'
    AND ${stockExpr("p.source_url")} IS NOT NULL
  GROUP BY 1,2
),
ranked AS (
  SELECT listing_id, stock, row_number() OVER (PARTITION BY listing_id ORDER BY n DESC, stock) rn
  FROM gal
),
canon AS (
  SELECT l.id AS listing_id,
         COALESCE(
           (SELECT stock FROM ranked r WHERE r.listing_id = l.id AND r.rn = 1),
           NULLIF(regexp_replace(COALESCE(l.source_id,''), '^im-', 'i'), '')
         ) AS stock
  FROM listings l
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE ($1::text IS NULL OR v.vin = $1)
),
doomed AS (
  SELECT p.id
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN canon c ON c.listing_id = l.id
  WHERE p.photo_group = 'exterior_3d'
    AND c.stock ~ '^[0-9]{6,}$'
    AND ${stockExpr("p.source_url")} = c.stock
    AND p.source_url ILIKE '%vis.iaai.com/resizer%'
    AND p.source_url ~* '(~|%7E)STP(~|%7E)'
    AND EXISTS (
      SELECT 1 FROM photos r
      WHERE r.listing_id = p.listing_id
        AND r.photo_group = 'exterior_3d'
        AND ${stockExpr("r.source_url")} = c.stock
        AND r.source_url ILIKE '%ThreeSixtyImageRetriever%'
    )
)
DELETE FROM photos p USING doomed d WHERE p.id = d.id
RETURNING p.id
`,
  [VIN],
);
console.log("deletedStpDup", delStp.rowCount);

// Reorder remaining 3d frames per listing+group by imageOrder
const reorder = await c.query(
  `
WITH ranked AS (
  SELECT p.id,
         row_number() OVER (
           PARTITION BY p.listing_id, p.photo_group
           ORDER BY
             COALESCE(
               NULLIF((regexp_match(p.source_url, 'imageOrder=(\\d+)', 'i'))[1], '')::int,
               NULLIF((regexp_match(p.source_url, '(?:~|%7E)I(\\d+)', 'i'))[1], '')::int,
               p.sort_order,
               p.id
             ),
             p.id
         ) - 1 AS new_order
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE p.photo_group IN ('exterior_3d','interior_3d')
    AND ($1::text IS NULL OR v.vin = $1)
)
UPDATE photos p
SET sort_order = r.new_order
FROM ranked r
WHERE p.id = r.id
  AND p.sort_order IS DISTINCT FROM r.new_order
RETURNING p.id
`,
  [VIN],
);
console.log("reordered", reorder.rowCount);

const after = await c.query(countSql, [VIN]);
console.log("after", after.rows[0]);

const porsche = await c.query(`
  SELECT
    ${stockExpr("source_url")} AS stock,
    photo_group,
    count(*)::int n,
    min(sort_order) mn,
    max(sort_order) mx,
    bool_or(source_url ILIKE '%ThreeSixtyImageRetriever%') AS has_retriever,
    bool_or(source_url ~* '(~|%7E)STP(~|%7E)') AS has_stp
  FROM photos p
  JOIN vehicles v ON v.id = p.vehicle_id
  WHERE v.vin = 'WP0AB2A92TS227786'
    AND p.photo_group IN ('gallery','exterior_3d','interior_3d')
  GROUP BY 1,2
  ORDER BY 2,1
`);
console.log("porsche", porsche.rows);

await c.end();
