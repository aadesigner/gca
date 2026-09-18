/**
 * Heal Import Motor / Encar galleries where inspection VIN-plate frames (_010+)
 * were stored as primary ahead of the car cover.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-heal-im-primary-photos.mjs --dry-run
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-heal-im-primary-photos.mjs --apply
 */
import fs from "node:fs";
import pg from "pg";
import { importMotorPhotoSortKey } from "../../artifacts/api-server/src/lib/providers/import-motor-parse.ts";

const apply = process.argv.includes("--apply");
const dryRun = !apply;

function loadProdUrl() {
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) =>
    vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n];
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const c = new pg.Client({ connectionString: loadProdUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();

console.log(dryRun ? "Mode: DRY RUN" : "Mode: APPLY");

const bad = await c.query(`
  SELECT DISTINCT ph.vehicle_id, v.vin
  FROM photos ph
  JOIN vehicles v ON v.id = ph.vehicle_id
  JOIN listings l ON l.id = ph.listing_id
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'import_motor'
    AND ph.is_primary = true
    AND coalesce(ph.photo_group, 'gallery') = 'gallery'
    AND (
      ph.source_url ~* 'ci\\.encar\\.com.*_(0[1-9][0-9]|[1-9][0-9]{2,})\\.(jpe?g|webp|png)'
      OR ph.source_url ~* 'import-motor\\.com/encar/.+_(0[1-9][0-9]|[1-9][0-9]{2,})\\.'
    )
  ORDER BY ph.vehicle_id
  LIMIT 5000
`);

console.log("vehicles with bad Encar primary:", bad.rows.length);

let fixed = 0;
const samples = [];

for (const row of bad.rows) {
  const photos = await c.query(
    `
    SELECT id, source_url, is_primary, sort_order
    FROM photos
    WHERE vehicle_id = $1
      AND coalesce(photo_group, 'gallery') = 'gallery'
    ORDER BY id
    `,
    [row.vehicle_id],
  );
  if (photos.rows.length === 0) continue;

  const ranked = photos.rows
    .map((p) => ({
      ...p,
      rank: importMotorPhotoSortKey(p.source_url || ""),
    }))
    .sort((a, b) => a.rank - b.rank || a.id - b.id);

  const hero = ranked[0];
  if (!hero || hero.is_primary) {
    // Still rewrite sort_order if primary happens to be correct but order is wrong
    const needsSort = ranked.some((p, i) => p.sort_order !== i || (i === 0) !== p.is_primary);
    if (!needsSort) continue;
  }

  if (samples.length < 8) {
    samples.push({
      vin: row.vin,
      from: photos.rows.find((p) => p.is_primary)?.source_url?.slice(-40),
      to: hero.source_url?.slice(-40),
      rank: hero.rank,
    });
  }

  if (!dryRun) {
    await c.query(`UPDATE photos SET is_primary = false WHERE vehicle_id = $1`, [row.vehicle_id]);
    for (let i = 0; i < ranked.length; i++) {
      await c.query(
        `UPDATE photos SET sort_order = $1, is_primary = $2 WHERE id = $3`,
        [i, i === 0, ranked[i].id],
      );
    }
  }
  fixed++;
}

console.log(JSON.stringify({ dryRun, candidates: bad.rows.length, fixed, samples }, null, 2));
await c.end();
