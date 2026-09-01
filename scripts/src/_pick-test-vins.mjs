import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function top(market, limit = 8) {
  const { rows } = await pool.query(
    `
    SELECT v.vin, v.make, v.model, v.year,
           (SELECT count(*)::int FROM listings l WHERE l.vin = v.vin) AS listings,
           (SELECT count(*)::int FROM vehicle_observations vo WHERE vo.vehicle_id = v.id) AS obs,
           (SELECT count(*)::int FROM vehicle_events ve WHERE ve.vehicle_id = v.id) AS events,
           (SELECT count(*)::int FROM photos ph WHERE ph.vehicle_id = v.id) AS photos
    FROM vehicles v
    WHERE EXISTS (
      SELECT 1 FROM listings l
      JOIN providers p ON p.id = l.provider_id
      WHERE l.vin = v.vin AND p.internal_name = $1
    )
    ORDER BY (
      (SELECT count(*) FROM vehicle_observations vo WHERE vo.vehicle_id = v.id) +
      (SELECT count(*) FROM vehicle_events ve WHERE ve.vehicle_id = v.id) +
      (SELECT count(*) FROM photos ph WHERE ph.vehicle_id = v.id)
    ) DESC
    LIMIT $2
    `,
    [market, limit],
  );
  return rows;
}

for (const m of ["encar", "autowini", "copart", "autotraderca", "carpages", "salvagebid"]) {
  console.log("\n===", m, "===");
  for (const r of await top(m, 5)) console.log(r);
}
await pool.end();
