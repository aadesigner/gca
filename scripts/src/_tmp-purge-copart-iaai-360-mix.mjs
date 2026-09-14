/**
 * Delete IAAI 360 frames wrongly attached to Copart Import Motor galleries
 * (Copart lot numbers ≠ IAAI stock IDs).
 *
 *   node ./scripts/src/_tmp-purge-copart-iaai-360-mix.mjs
 *   DRY_RUN=1 node ./scripts/src/_tmp-purge-copart-iaai-360-mix.mjs
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
  connectionTimeoutMillis: 25000,
});
await c.connect();

const countSql = `
  SELECT count(*)::int AS n,
         count(DISTINCT p.vehicle_id)::int AS vehicles
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = p.vehicle_id
  WHERE pr.internal_name = 'import_motor'
    AND p.photo_group IN ('exterior_3d', 'interior_3d')
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
          COALESCE(g2.source_url, g2.stored_path, '') ILIKE '%iaai%'
          OR COALESCE(g2.source_url, g2.stored_path, '') ILIKE '%/iaa/%'
        )
    )
    AND ($1::text IS NULL OR v.vin = $1)
`;

const before = await c.query(countSql, [VIN]);
console.log({ dry: DRY, vin: VIN, matched: before.rows[0] });

if (!DRY && before.rows[0].n > 0) {
  const del = await c.query(
    `
    DELETE FROM photos p
    USING listings l, providers pr, vehicles v
    WHERE p.listing_id = l.id
      AND l.provider_id = pr.id
      AND p.vehicle_id = v.id
      AND pr.internal_name = 'import_motor'
      AND p.photo_group IN ('exterior_3d', 'interior_3d')
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
            COALESCE(g2.source_url, g2.stored_path, '') ILIKE '%iaai%'
            OR COALESCE(g2.source_url, g2.stored_path, '') ILIKE '%/iaa/%'
          )
      )
      AND ($1::text IS NULL OR v.vin = $1)
    RETURNING p.id, v.vin, p.photo_group
    `,
    [VIN],
  );
  console.log({ deleted: del.rowCount, sample: del.rows.slice(0, 5) });
}

await c.end();
