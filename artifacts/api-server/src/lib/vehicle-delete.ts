import {
  db,
  vehiclesTable,
  listingsTable,
  vehicleObservationsTable,
  vehicleEventsTable,
  photosTable,
  rawSourceRecordsTable,
  normalizationOverridesTable,
} from "@workspace/db";
import { eq, inArray, sql, count } from "drizzle-orm";

export async function deleteVehicleByVin(vin: string): Promise<boolean> {
  const [vehicle] = await db
    .select({ id: vehiclesTable.id })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.vin, vin.toUpperCase()));

  if (!vehicle) return false;
  await deleteVehiclesByIds([vehicle.id]);
  return true;
}

export async function deleteVehiclesByIds(vehicleIds: number[]): Promise<number> {
  if (vehicleIds.length === 0) return 0;

  const listingRows = await db
    .select({ id: listingsTable.id })
    .from(listingsTable)
    .where(inArray(listingsTable.vehicleId, vehicleIds));
  const listingIds = listingRows.map((r) => r.id);

  if (listingIds.length > 0) {
    await db.delete(rawSourceRecordsTable).where(inArray(rawSourceRecordsTable.listingId, listingIds));
    await db.delete(photosTable).where(inArray(photosTable.listingId, listingIds));
  }

  await db.delete(photosTable).where(inArray(photosTable.vehicleId, vehicleIds));
  await db.delete(normalizationOverridesTable).where(inArray(normalizationOverridesTable.vehicleId, vehicleIds));
  await db.delete(vehicleObservationsTable).where(inArray(vehicleObservationsTable.vehicleId, vehicleIds));
  await db.delete(vehicleEventsTable).where(inArray(vehicleEventsTable.vehicleId, vehicleIds));
  await db.delete(listingsTable).where(inArray(listingsTable.vehicleId, vehicleIds));

  const deleted = await db
    .delete(vehiclesTable)
    .where(inArray(vehiclesTable.id, vehicleIds))
    .returning({ id: vehiclesTable.id });

  return deleted.length;
}

/** Delete every vehicle and related history in one transaction (no row limit). */
export async function deleteAllVehicles(): Promise<number> {
  const [[totalRow]] = await Promise.all([
    db.select({ c: count() }).from(vehiclesTable),
  ]);
  const total = Number(totalRow?.c ?? 0);
  if (total === 0) return 0;

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM raw_source_records
      WHERE listing_id IN (SELECT id FROM listings WHERE vehicle_id IS NOT NULL)
    `);
    await tx.execute(sql`
      DELETE FROM photos
      WHERE vehicle_id IS NOT NULL
         OR listing_id IN (SELECT id FROM listings WHERE vehicle_id IS NOT NULL)
    `);
    await tx.execute(sql`DELETE FROM normalization_overrides`);
    await tx.execute(sql`DELETE FROM vehicle_observations`);
    await tx.execute(sql`DELETE FROM vehicle_events`);
    await tx.execute(sql`DELETE FROM listings WHERE vehicle_id IS NOT NULL`);
    await tx.execute(sql`DELETE FROM vehicles`);
  });

  return total;
}
