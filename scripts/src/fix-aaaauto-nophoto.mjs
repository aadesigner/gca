/**
 * Delete AAA Auto placeholder photos (nophoto-big) that were mirrored to the
 * same CDN object and made every empty listing look identical.
 *
 * Usage:
 *   node --import ./scripts/load-env.mjs ./scripts/src/fix-aaaauto-nophoto.mjs
 *   node --import ./scripts/load-env.mjs ./scripts/src/fix-aaaauto-nophoto.mjs --apply
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pg = require("../../lib/db/node_modules/pg");

const apply = process.argv.includes("--apply");
const useProd = process.argv.includes("--prod") || process.env.FIX_TARGET === "prod";

const client = useProd
  ? new pg.Client({
      host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
      port: Number(process.env.PROD_PG_PORT || 15622),
      user: process.env.PROD_PG_USER || "postgres",
      password: process.env.PROD_PG_PASSWORD,
      database: process.env.PROD_PG_DATABASE || "railway",
    })
  : new pg.Client(process.env.DATABASE_URL);

await client.connect();
console.log(useProd ? "target=PROD" : "target=LOCAL", apply ? "APPLY" : "DRY-RUN");

const pid = (await client.query(`SELECT id FROM providers WHERE internal_name='aaaauto'`)).rows[0]?.id;
if (!pid) {
  console.error("aaaauto provider not found");
  process.exit(1);
}

const preview = await client.query(
  `
  SELECT count(*)::int AS photos, count(DISTINCT vehicle_id)::int AS vehicles
  FROM photos
  WHERE vehicle_id IN (SELECT vehicle_id FROM listings WHERE provider_id = $1)
    AND (
      source_url ILIKE '%nophoto%'
      OR source_url ILIKE '%no-photo%'
      OR source_url ILIKE '%no_photo%'
      OR stored_path ILIKE '%382a7a92738b030f0c8076a1f8b2e1cabf10e27e%'
    )
  `,
  [pid],
);
console.log("placeholder photos to delete", preview.rows[0]);

if (apply) {
  const del = await client.query(
    `
    DELETE FROM photos
    WHERE id IN (
      SELECT p.id
      FROM photos p
      JOIN listings l ON l.vehicle_id = p.vehicle_id
      WHERE l.provider_id = $1
        AND (
          p.source_url ILIKE '%nophoto%'
          OR p.source_url ILIKE '%no-photo%'
          OR p.source_url ILIKE '%no_photo%'
          OR p.stored_path ILIKE '%382a7a92738b030f0c8076a1f8b2e1cabf10e27e%'
        )
    )
    RETURNING id
    `,
    [pid],
  );
  console.log("deleted", del.rowCount);

  await client.query(
    `UPDATE providers SET parser_version = 'aaaauto-v1.0.2', updated_at = now() WHERE id = $1`,
    [pid],
  ).catch(() =>
    client.query(`UPDATE providers SET parser_version = 'aaaauto-v1.0.2' WHERE id = $1`, [pid]),
  );
  console.log("parser_version bumped to aaaauto-v1.0.2");
} else {
  console.log("Re-run with --apply --prod to delete on production");
}

await client.end();
