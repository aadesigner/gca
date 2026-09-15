import pg from "pg";

const SINCE = process.env.SINCE || "2026-09-15 18:08:45+00"; // last push 20:08 +0200
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip",
});
await c.connect();

console.log("since", SINCE);

const byProvider = await c.query(
  `
  SELECT pr.internal_name,
         count(*)::int AS listings,
         count(DISTINCT l.vin)::int AS vins,
         count(*) FILTER (WHERE l.created_at >= $1::timestamptz)::int AS new_listings
  FROM listings l
  JOIN providers pr ON pr.id = l.provider_id
  WHERE l.created_at >= $1::timestamptz
     OR l.last_seen_at >= $1::timestamptz
  GROUP BY 1
  ORDER BY new_listings DESC, listings DESC
`,
  [SINCE],
);
console.log("\nactivityByProvider (created or last_seen since push)");
console.table(byProvider.rows);

const newListings = await c.query(
  `
  SELECT pr.internal_name,
         count(*)::int AS n,
         count(DISTINCT l.vehicle_id)::int AS vehicles
  FROM listings l
  JOIN providers pr ON pr.id = l.provider_id
  WHERE l.created_at >= $1::timestamptz
  GROUP BY 1
  ORDER BY n DESC
`,
  [SINCE],
);
console.log("\nnewListingsCreated");
console.table(newListings.rows);

const newVehicles = await c.query(
  `
  SELECT count(*)::int AS n
  FROM vehicles v
  WHERE v.created_at >= $1::timestamptz
`,
  [SINCE],
);
console.log("newVehiclesCreated", newVehicles.rows[0]);

const sample = await c.query(
  `
  SELECT v.vin, v.year, v.make, v.model, v.country, pr.internal_name,
         l.created_at,
         (SELECT count(*)::int FROM photos p WHERE p.vehicle_id = v.id AND COALESCE(p.photo_group,'gallery')='gallery') AS gallery,
         (SELECT count(*)::int FROM photos p WHERE p.vehicle_id = v.id AND p.photo_group='exterior_3d') AS ext3d,
         (SELECT count(*)::int FROM photos p WHERE p.vehicle_id = v.id AND p.photo_group='interior_3d') AS int3d,
         (SELECT count(*)::int FROM vehicle_events e WHERE e.vehicle_id = v.id AND e.metadata::text ILIKE '%encar_inspection%') AS encar_insp_events,
         (SELECT count(*)::int FROM vehicle_events e WHERE e.vehicle_id = v.id AND e.metadata::text ILIKE '%encar_diagnosis%') AS encar_diag_events,
         (SELECT count(*)::int FROM vehicle_events e WHERE e.vehicle_id = v.id AND e.metadata::text ILIKE '%bodyCondition%') AS body_cond_events
  FROM vehicles v
  JOIN listings l ON l.vehicle_id = v.id
  JOIN providers pr ON pr.id = l.provider_id
  WHERE v.created_at >= $1::timestamptz
  ORDER BY v.created_at DESC
  LIMIT 40
`,
  [SINCE],
);
console.log("\nnewestVehicles sample");
for (const r of sample.rows) {
  console.log(
    `${r.created_at?.toISOString?.() ?? r.created_at} ${r.internal_name} ${r.vin} ${r.year ?? ""} ${r.make ?? ""} ${r.model ?? ""} | gal=${r.gallery} ext3d=${r.ext3d} int3d=${r.int3d} insp=${r.encar_insp_events} diag=${r.encar_diag_events} body=${r.body_cond_events}`,
  );
}

// Encar new since push — diagram / inspection extras signals
const encar = await c.query(
  `
  SELECT v.vin, v.year, v.make, v.model, v.created_at,
    (SELECT count(*) FROM vehicle_events e WHERE e.vehicle_id=v.id AND e.metadata::text ILIKE '%"source":"encar_diagnosis"%')::int AS diag,
    (SELECT count(*) FROM vehicle_events e WHERE e.vehicle_id=v.id AND e.metadata::text ILIKE '%"source":"encar_inspection"%')::int AS insp,
    (SELECT count(*) FROM vehicle_events e WHERE e.vehicle_id=v.id AND e.metadata::text ILIKE '%"source":"encar_inspection_panels"%')::int AS panels,
    (SELECT count(*) FROM vehicle_events e WHERE e.vehicle_id=v.id AND e.metadata::text ILIKE '%"field":"inspection_condition"%')::int AS cond_extra,
    (SELECT count(*) FROM vehicle_events e WHERE e.vehicle_id=v.id AND e.metadata::text ILIKE '%"field":"inspection_comments"%')::int AS comments_extra,
    (SELECT count(*) FROM vehicle_events e WHERE e.vehicle_id=v.id AND e.metadata::text ILIKE '%"field":"simple_repair"%')::int AS simple_extra,
    (SELECT count(*) FROM vehicle_events e WHERE e.vehicle_id=v.id AND e.metadata::text ILIKE '%"simpleRepair":true%')::int AS simple_evt
  FROM vehicles v
  WHERE v.created_at >= $1::timestamptz
    AND EXISTS (
      SELECT 1 FROM listings l
      JOIN providers pr ON pr.id=l.provider_id
      WHERE l.vehicle_id=v.id AND pr.internal_name IN ('encar','ams','import_motor')
    )
  ORDER BY v.created_at DESC
  LIMIT 25
`,
  [SINCE],
);
console.log("\nencarRelatedNewVehicles signals");
console.table(encar.rows);

const photoGroups = await c.query(
  `
  SELECT COALESCE(p.photo_group,'gallery') AS grp, count(*)::int AS n
  FROM photos p
  JOIN vehicles v ON v.id = p.vehicle_id
  WHERE v.created_at >= $1::timestamptz
  GROUP BY 1 ORDER BY 2 DESC
`,
  [SINCE],
);
console.log("\nphotoGroupsOnNewVehicles");
console.table(photoGroups.rows);

await c.end();
