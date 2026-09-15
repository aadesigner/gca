import pg from "pg";

const VIN = "WBS3C910XFP708160";
const base = (process.env.DATABASE_URL || "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip").replace(
  /[?&]sslmode=[^&]+/i,
  "",
);
const c = new pg.Client({ connectionString: `${base}?sslmode=disable` });
await c.connect();

const v = (await c.query(`SELECT id, vin FROM vehicles WHERE vin=$1`, [VIN])).rows[0];
console.log("vehicle", v);

const events = await c.query(
  `
  SELECT id, event_type, description, occurred_at::date AS day, created_at,
         left(coalesce(metadata::text,''), 180) AS meta
  FROM vehicle_events
  WHERE vehicle_id=$1
  ORDER BY occurred_at DESC NULLS LAST, id DESC
  `,
  [v.id],
);
console.log("events_total", events.rowCount);
const insp = events.rows.filter((r) => /inspection report uploaded/i.test(r.description || ""));
console.log("inspection_uploaded", insp.length);
console.log(insp);
console.log(
  "event_type_counts",
  Object.entries(
    events.rows.reduce((acc, r) => {
      const k = `${r.event_type}|${r.description}`;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]),
);

const listings = await c.query(
  `
  SELECT l.id, p.internal_name, l.source_id, l.is_active,
         left(coalesce(l.source_url,''), 100) AS source_url,
         (SELECT count(*)::int FROM photos ph WHERE ph.listing_id=l.id) AS listing_photos
  FROM listings l
  JOIN providers p ON p.id=l.provider_id
  WHERE l.vehicle_id=$1
  ORDER BY p.internal_name, l.id
  `,
  [v.id],
);
console.log("listings", listings.rows);

const photoStats = await c.query(
  `
  SELECT p.internal_name,
         count(*)::int AS n,
         count(*) FILTER (WHERE ph.is_primary)::int AS primaries,
         min(ph.sort_order) AS min_ord,
         max(ph.sort_order) AS max_ord,
         count(DISTINCT ph.sort_order)::int AS distinct_orders,
         count(*) FILTER (WHERE ph.stored_path IS NOT NULL)::int AS with_cdn
  FROM photos ph
  LEFT JOIN listings l ON l.id=ph.listing_id
  LEFT JOIN providers p ON p.id=l.provider_id
  WHERE ph.vehicle_id=$1
  GROUP BY p.internal_name
  ORDER BY n DESC
  `,
  [v.id],
);
console.log("photos_by_provider", photoStats.rows);

const orderSample = await c.query(
  `
  SELECT ph.id, p.internal_name, ph.listing_id, ph.sort_order, ph.is_primary,
         ph.photo_group,
         left(ph.source_url, 100) AS src,
         left(coalesce(ph.stored_path,''), 70) AS stored
  FROM photos ph
  LEFT JOIN listings l ON l.id=ph.listing_id
  LEFT JOIN providers p ON p.id=l.provider_id
  WHERE ph.vehicle_id=$1 AND coalesce(ph.photo_group,'gallery')='gallery'
  ORDER BY ph.sort_order ASC, ph.id ASC
  LIMIT 50
  `,
  [v.id],
);
console.log("gallery_in_sort_order", orderSample.rows);

const dupes = await c.query(
  `
  SELECT left(ph.source_url, 90) AS src, count(*)::int AS n, array_agg(ph.id ORDER BY ph.id) AS ids,
         array_agg(ph.sort_order ORDER BY ph.id) AS orders
  FROM photos ph
  WHERE ph.vehicle_id=$1 AND coalesce(ph.photo_group,'gallery')='gallery'
  GROUP BY left(ph.source_url, 90)
  HAVING count(*) > 1
  LIMIT 20
  `,
  [v.id],
);
console.log("exact_url_dupes", dupes.rows);

const bd = listings.rows.filter((r) => /bidrive/i.test(r.internal_name));
for (const row of bd) {
  const ph = await c.query(
    `
    SELECT id, sort_order, is_primary, photo_group,
           source_url, stored_path
    FROM photos WHERE listing_id=$1 OR (vehicle_id=$2 AND source_url ILIKE '%thebidrive%')
    ORDER BY listing_id NULLS LAST, sort_order, id
    LIMIT 30
    `,
    [row.id, v.id],
  );
  console.log("bidrive_listing", row, "photos", ph.rows);
}

await c.end();
