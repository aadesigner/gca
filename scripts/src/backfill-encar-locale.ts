/**
 * Backfill Korean Encar spec/location fields to English in the DB.
 * Run: pnpm backfill:encar-locale
 */
import pg from "pg";
import {
  containsHangul,
  normalizeEncarLocation,
  normalizeEncarTextField,
} from "../../artifacts/api-server/src/lib/providers/encar-locale.ts";

await import("../load-env.mjs");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function normalizeField(
  field: "fuelType" | "transmission" | "bodyType" | "color",
  value: string | null,
): string | null {
  if (!value || !containsHangul(value)) return value;
  return normalizeEncarTextField(field, value) ?? value;
}

async function backfillVehicles(): Promise<number> {
  const { rows } = await pool.query<{
    id: number;
    fuel_type: string | null;
    transmission: string | null;
    body_type: string | null;
    color: string | null;
  }>(`SELECT id, fuel_type, transmission, body_type, color FROM vehicles`);

  let updated = 0;
  for (const row of rows) {
    const fuelType = normalizeField("fuelType", row.fuel_type);
    const transmission = normalizeField("transmission", row.transmission);
    const bodyType = normalizeField("bodyType", row.body_type);
    const color = normalizeField("color", row.color);

    if (
      fuelType === row.fuel_type &&
      transmission === row.transmission &&
      bodyType === row.body_type &&
      color === row.color
    ) {
      continue;
    }

    await pool.query(
      `UPDATE vehicles
       SET fuel_type = $1, transmission = $2, body_type = $3, color = $4, updated_at = NOW()
       WHERE id = $5`,
      [fuelType, transmission, bodyType, color, row.id],
    );
    updated++;
  }
  return updated;
}

async function backfillLocations(table: "listings" | "vehicle_observations"): Promise<number> {
  const { rows } = await pool.query<{ id: number; location: string | null }>(
    `SELECT id, location FROM ${table} WHERE location IS NOT NULL`,
  );

  let updated = 0;
  for (const row of rows) {
    if (!row.location || !containsHangul(row.location)) continue;
    const location = normalizeEncarLocation(row.location);
    if (!location || location === row.location) continue;

    await pool.query(`UPDATE ${table} SET location = $1 WHERE id = $2`, [location, row.id]);
    updated++;
  }
  return updated;
}

console.log("Backfilling Encar Korean fields to English…");
const vehicles = await backfillVehicles();
const listings = await backfillLocations("listings");
const observations = await backfillLocations("vehicle_observations");
console.log(`Updated ${vehicles} vehicles, ${listings} listings, ${observations} observations.`);
await pool.end();
