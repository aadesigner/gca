import pg from "pg";

const vin = process.argv[2] || "WDDUX8GB8JA397509";
const mode = process.argv[3] || "vin";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

if (mode === "stats") {
  const r = await pool.query(`
    SELECT count(*)::int AS vins_with_multi_listing
    FROM (
      SELECT vin FROM listings
      WHERE vin IS NOT NULL AND vin <> ''
      GROUP BY vin HAVING count(DISTINCT id) > 1
    ) t`);
  const kr = await pool.query(`
    SELECT count(*)::int AS kr_vins_multi
    FROM (
      SELECT l.vin FROM listings l
      JOIN providers p ON p.id = l.provider_id
      WHERE l.vin IS NOT NULL AND l.vin <> ''
        AND (p.country ILIKE '%korea%' OR p.internal_name IN ('encar','autowini','kbchachacha'))
      GROUP BY l.vin HAVING count(DISTINCT l.id) > 1
    ) t`);
  const mixed = await pool.query(`
    SELECT count(*)::int AS vins_mixed_photos
    FROM (
      SELECT ph.vehicle_id
      FROM photos ph
      GROUP BY ph.vehicle_id
      HAVING count(DISTINCT ph.listing_id) > 1
    ) t`);
  const kmcheck = await pool.query(`
    SELECT count(*)::int AS kmcheck_listings
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    WHERE p.internal_name IN ('kmcheck','kmcheck_manual','carstat')
      AND l.vin IS NOT NULL AND l.vin <> ''`);
  console.log(JSON.stringify({
    multiListingVins: r.rows[0].vins_with_multi_listing,
    krMultiListingVins: kr.rows[0].kr_vins_multi,
    vinsWithMixedListingPhotos: mixed.rows[0].vins_mixed_photos,
    kmcheckListingsWithVin: kmcheck.rows[0].kmcheck_listings,
  }, null, 2));
  await pool.end();
  process.exit(0);
}

const v = await pool.query(
  "SELECT id, make, model, year, color FROM vehicles WHERE vin = $1",
  [vin],
);
console.log("vehicle:", v.rows[0] ?? null);
if (!v.rows[0]) {
  await pool.end();
  process.exit(0);
}
const vid = v.rows[0].id;

const listings = await pool.query(
  `SELECT l.id, p.internal_name, l.source_id, l.title, l.is_active,
          (SELECT count(*)::int FROM photos ph WHERE ph.listing_id = l.id) AS photo_count
   FROM listings l
   JOIN providers p ON p.id = l.provider_id
   WHERE l.vin = $1
   ORDER BY l.last_seen_at DESC`,
  [vin],
);
console.log("\nlistings:", listings.rows);

const byListing = await pool.query(
  `SELECT ph.listing_id, count(*)::int AS n
   FROM photos ph WHERE ph.vehicle_id = $1
   GROUP BY ph.listing_id ORDER BY n DESC`,
  [vid],
);
console.log("\nphotos by listing:", byListing.rows);

const photos = await pool.query(
  `SELECT ph.id, ph.listing_id, ph.is_primary, ph.sort_order, ph.photo_group,
          left(ph.source_url, 100) AS source_url
   FROM photos ph
   WHERE ph.vehicle_id = $1
   ORDER BY ph.sort_order ASC, ph.id ASC`,
  [vid],
);
console.log("\ntotal photos:", photos.rows.length);
for (const r of photos.rows.slice(0, 20)) {
  console.log(`  [${r.sort_order}] listing=${r.listing_id} primary=${r.is_primary} ${r.source_url}`);
}

await pool.end();

