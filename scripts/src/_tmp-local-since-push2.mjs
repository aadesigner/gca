import pg from "pg";

const SINCE = "2026-09-15 18:08:45+00";
const c = new pg.Client({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip",
});
await c.connect();

// Listings created since push (even if vehicle older)
const listingStats = await c.query(
  `
  SELECT pr.internal_name,
    count(*)::int AS listings,
    count(*) FILTER (WHERE v.created_at >= $1::timestamptz)::int AS brand_new_vins,
    count(*) FILTER (WHERE v.created_at < $1::timestamptz)::int AS existing_vins,
    round(avg(gal.n)::numeric,1) AS avg_gallery,
    count(*) FILTER (WHERE gal.n = 0)::int AS zero_gallery,
    count(*) FILTER (WHERE ext.n > 0)::int AS with_ext3d,
    count(*) FILTER (WHERE int3.n > 0)::int AS with_int3d
  FROM listings l
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  LEFT JOIN LATERAL (
    SELECT count(*)::int n FROM photos p
    WHERE p.listing_id = l.id AND COALESCE(p.photo_group,'gallery')='gallery'
  ) gal ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int n FROM photos p
    WHERE p.listing_id = l.id AND p.photo_group='exterior_3d'
  ) ext ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int n FROM photos p
    WHERE p.listing_id = l.id AND p.photo_group='interior_3d'
  ) int3 ON true
  WHERE l.created_at >= $1::timestamptz
  GROUP BY 1 ORDER BY listings DESC
`,
  [SINCE],
);
console.log("listingCreatedSincePush");
console.table(listingStats.rows);

const iaa = await c.query(
  `
  SELECT v.vin, v.year, v.make, v.model, l.source_id, l.created_at,
    (SELECT count(*) FROM photos p WHERE p.listing_id=l.id AND COALESCE(p.photo_group,'gallery')='gallery')::int AS gallery,
    (SELECT count(*) FROM photos p WHERE p.listing_id=l.id AND p.photo_group='exterior_3d')::int AS ext3d,
    (SELECT count(*) FROM photos p WHERE p.listing_id=l.id AND p.photo_group='interior_3d')::int AS int3d,
    (SELECT count(*) FROM photos p WHERE p.vehicle_id=v.id AND p.photo_group='interior_3d')::int AS vin_int3d
  FROM listings l
  JOIN providers pr ON pr.id=l.provider_id AND pr.internal_name='iaa'
  JOIN vehicles v ON v.id=l.vehicle_id
  WHERE l.created_at >= $1::timestamptz
  ORDER BY l.created_at DESC
`,
  [SINCE],
);
console.log("\niaaNewListings");
console.table(iaa.rows);

const jctGal = await c.query(
  `
  SELECT
    count(*)::int AS listings,
    count(*) FILTER (WHERE gal.n >= 10)::int AS gal_ge10,
    count(*) FILTER (WHERE gal.n BETWEEN 2 AND 9)::int AS gal_2_9,
    count(*) FILTER (WHERE gal.n = 1)::int AS gal_1,
    count(*) FILTER (WHERE gal.n = 0)::int AS gal_0,
    round(avg(gal.n)::numeric,1) AS avg_gal,
    max(gal.n) AS max_gal
  FROM listings l
  JOIN providers pr ON pr.id=l.provider_id AND pr.internal_name='japanesecartrade'
  LEFT JOIN LATERAL (
    SELECT count(*)::int n FROM photos p WHERE p.listing_id=l.id AND COALESCE(p.photo_group,'gallery')='gallery'
  ) gal ON true
  WHERE l.created_at >= $1::timestamptz
`,
  [SINCE],
);
console.log("\njctPhotoSpread");
console.table(jctGal.rows);

const copart = await c.query(
  `
  SELECT
    count(*)::int AS listings,
    count(*) FILTER (WHERE gal.n >= 8)::int AS gal_ge8,
    count(*) FILTER (WHERE gal.n = 0)::int AS gal_0,
    round(avg(gal.n)::numeric,1) AS avg_gal
  FROM listings l
  JOIN providers pr ON pr.id=l.provider_id AND pr.internal_name='copart'
  LEFT JOIN LATERAL (
    SELECT count(*)::int n FROM photos p WHERE p.listing_id=l.id AND COALESCE(p.photo_group,'gallery')='gallery'
  ) gal ON true
  WHERE l.created_at >= $1::timestamptz
`,
  [SINCE],
);
console.log("\ncopartPhotoSpread");
console.table(copart.rows);

// Any interior_3d still being written since push?
const intWrites = await c.query(
  `
  SELECT count(*)::int AS n, max(created_at) AS latest
  FROM photos
  WHERE photo_group='interior_3d' AND created_at >= $1::timestamptz
`,
  [SINCE],
);
console.log("\ninterior3dRowsWrittenSincePush", intWrites.rows[0]);

const extWrites = await c.query(
  `
  SELECT count(*)::int AS n, max(created_at) AS latest
  FROM photos
  WHERE photo_group='exterior_3d' AND created_at >= $1::timestamptz
`,
  [SINCE],
);
console.log("exterior3dRowsWrittenSincePush", extWrites.rows[0]);

await c.end();
