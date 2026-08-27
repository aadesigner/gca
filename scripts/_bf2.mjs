import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const upd = await pool.query(`
  WITH src AS (
    SELECT DISTINCT ON (v.id)
      v.id AS vehicle_id,
      v.vin,
      v.current_known_mileage AS stored,
      COALESCE(o.mileage, l.mileage)::numeric AS miles
    FROM vehicles v
    LEFT JOIN LATERAL (
      SELECT mileage, mileage_unit FROM vehicle_observations
      WHERE vehicle_id = v.id AND lower(coalesce(mileage_unit,'')) IN ('mi','mile','miles') AND mileage IS NOT NULL
      ORDER BY observed_at DESC NULLS LAST LIMIT 1
    ) o ON true
    LEFT JOIN LATERAL (
      SELECT mileage, mileage_unit FROM listings
      WHERE vehicle_id = v.id AND lower(coalesce(mileage_unit,'')) IN ('mi','mile','miles') AND mileage IS NOT NULL
      ORDER BY last_seen_at DESC NULLS LAST LIMIT 1
    ) l ON true
    WHERE v.current_known_mileage IS NOT NULL
      AND COALESCE(o.mileage, l.mileage) IS NOT NULL
      AND v.current_known_mileage = COALESCE(o.mileage, l.mileage)
  )
  UPDATE vehicles v
  SET current_known_mileage = ROUND(src.miles / 0.621371)::int,
      updated_at = NOW()
  FROM src
  WHERE v.id = src.vehicle_id
  RETURNING v.vin, src.stored AS was_miles, v.current_known_mileage AS now_km
`);
console.log("converted", upd.rowCount);
console.log("camaro", upd.rows.find(r => r.vin === "2G1FA1E35D9105508") || "not in batch");
const check = await pool.query(`SELECT vin, current_known_mileage FROM vehicles WHERE vin='2G1FA1E35D9105508'`);
console.log("camaro_row", check.rows[0]);
await pool.end();
