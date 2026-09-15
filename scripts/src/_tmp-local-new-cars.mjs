import pg from "pg";

const SINCE = "2026-09-15 18:08:45+00";
const c = new pg.Client({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip",
});
await c.connect();

const summary = await c.query(
  `
  SELECT pr.internal_name,
    count(DISTINCT v.id)::int AS new_vins,
    count(DISTINCT v.make)::int AS makes,
    min(v.year) AS year_min,
    max(v.year) AS year_max
  FROM vehicles v
  JOIN listings l ON l.vehicle_id = v.id AND l.created_at >= $1::timestamptz
  JOIN providers pr ON pr.id = l.provider_id
  WHERE v.created_at >= $1::timestamptz
  GROUP BY 1
  ORDER BY new_vins DESC
`,
  [SINCE],
);
console.log("brandNewVinsByProvider");
console.table(summary.rows);

const byMake = await c.query(
  `
  SELECT coalesce(v.make,'(none)') AS make, count(*)::int AS n
  FROM vehicles v
  WHERE v.created_at >= $1::timestamptz
  GROUP BY 1 ORDER BY n DESC LIMIT 15
`,
  [SINCE],
);
console.log("newCarsByMake");
console.table(byMake.rows);

const sample = await c.query(
  `
  SELECT v.vin, v.year, v.make, v.model, v.trim, v.fuel_type, v.transmission,
         v.body_type, v.country, v.current_known_mileage AS km,
         pr.internal_name AS via,
         l.price_amount, l.price_currency,
         (SELECT count(*)::int FROM vehicle_events e WHERE e.vehicle_id=v.id) AS events,
         (SELECT string_agg(DISTINCT e.event_type, ',') FROM vehicle_events e WHERE e.vehicle_id=v.id) AS event_types
  FROM vehicles v
  JOIN listings l ON l.vehicle_id = v.id
  JOIN providers pr ON pr.id = l.provider_id
  WHERE v.created_at >= $1::timestamptz
  ORDER BY v.created_at DESC
  LIMIT 30
`,
  [SINCE],
);
console.log("\nnewestCars");
for (const r of sample.rows) {
  console.log(
    `${r.via} | ${r.year ?? "?"} ${r.make ?? "?"} ${r.model ?? "?"} ${r.trim ?? ""} | ${r.vin} | ${r.country ?? "?"} | ${r.km != null ? r.km + "km" : "?"} | ${r.fuel_type ?? "?"} / ${r.transmission ?? "?"} / ${r.body_type ?? "?"} | events=${r.events} [${r.event_types ?? ""}] | ${r.price_amount != null ? r.price_amount + " " + (r.price_currency ?? "") : "no price"}`,
  );
}

// Also listings on existing VINs since push (not brand-new vehicles)
const existing = await c.query(
  `
  SELECT pr.internal_name, count(*)::int AS listings_on_old_vins
  FROM listings l
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE l.created_at >= $1::timestamptz
    AND v.created_at < $1::timestamptz
  GROUP BY 1 ORDER BY 2 DESC
`,
  [SINCE],
);
console.log("\nlistingsAttachedToOlderVins");
console.table(existing.rows);

await c.end();
