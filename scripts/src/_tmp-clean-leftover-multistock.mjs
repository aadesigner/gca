import fs from "node:fs";
import pg from "pg";
const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => { const v = vars[n]; return v && typeof v === "object" && "value" in v ? v.value : v; };
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const leftover = await c.query(`
  SELECT v.vin, l.id AS listing_id, l.source_id,
    array_agg(DISTINCT COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})(?:%7E|~)SID', 'i'))[1]
    )) AS stocks,
    count(*)::int frames
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN vehicles v ON v.id = p.vehicle_id
  WHERE p.photo_group IN ('exterior_3d','interior_3d')
  GROUP BY v.vin, l.id, l.source_id
  HAVING count(DISTINCT COALESCE(
    (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
    (regexp_match(p.source_url, 'imageKeys=(\\d{6,})(?:%7E|~)SID', 'i'))[1]
  )) > 1
  ORDER BY frames DESC
  LIMIT 20
`);
console.log("leftover", leftover.rows);

// For leftovers: keep stock matching source_id, else majority of spin frames, delete others
const cleaned = await c.query(`
WITH multi AS (
  SELECT p.listing_id
  FROM photos p
  WHERE p.photo_group IN ('exterior_3d','interior_3d') AND p.listing_id IS NOT NULL
  GROUP BY p.listing_id
  HAVING count(DISTINCT COALESCE(
    (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
    (regexp_match(p.source_url, 'imageKeys=(\\d{6,})(?:%7E|~)SID', 'i'))[1]
  )) > 1
),
spin_stock AS (
  SELECT p.listing_id,
    COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})(?:%7E|~)SID', 'i'))[1]
    ) AS stock,
    count(*)::int n
  FROM photos p
  JOIN multi m ON m.listing_id = p.listing_id
  WHERE p.photo_group IN ('exterior_3d','interior_3d')
  GROUP BY 1,2
),
canon AS (
  SELECT l.id AS listing_id,
    COALESCE(
      CASE WHEN NULLIF(regexp_replace(COALESCE(l.source_id,''), '^im-', 'i'), '') ~ '^[0-9]{6,}$'
        AND EXISTS (
          SELECT 1 FROM spin_stock s
          WHERE s.listing_id = l.id
            AND s.stock = NULLIF(regexp_replace(COALESCE(l.source_id,''), '^im-', 'i'), '')
        )
        THEN NULLIF(regexp_replace(COALESCE(l.source_id,''), '^im-', 'i'), '')
      END,
      (SELECT stock FROM spin_stock s WHERE s.listing_id = l.id ORDER BY n DESC, stock LIMIT 1)
    ) AS stock
  FROM listings l
  JOIN multi m ON m.listing_id = l.id
),
doomed AS (
  SELECT p.id
  FROM photos p
  JOIN canon c ON c.listing_id = p.listing_id
  WHERE p.photo_group IN ('exterior_3d','interior_3d')
    AND c.stock IS NOT NULL
    AND COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})(?:%7E|~)SID', 'i'))[1]
    ) IS DISTINCT FROM c.stock
)
DELETE FROM photos p USING doomed d WHERE p.id = d.id
RETURNING p.id
`);
console.log("cleanedLeftover", cleaned.rowCount);

const multi2 = await c.query(`
  SELECT count(*)::int AS listings_multi_stock FROM (
    SELECT p.listing_id
    FROM photos p
    WHERE p.photo_group IN ('exterior_3d','interior_3d') AND p.listing_id IS NOT NULL
    GROUP BY p.listing_id
    HAVING count(DISTINCT COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})(?:%7E|~)SID', 'i'))[1]
    )) > 1
  ) t
`);
console.log("remainingMulti", multi2.rows[0]);
await c.end();
