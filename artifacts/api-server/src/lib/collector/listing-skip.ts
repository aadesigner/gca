import { db, listingsTable, photosTable, rawSourceRecordsTable, vehiclesTable } from "@workspace/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

/**
 * Returns sourceIds that were collected recently for this provider.
 * Used to skip expensive detail fetches on re-crawls.
 */
export async function findRecentlySeenSourceIds(
  providerId: number,
  sourceIds: string[],
  skipIfSeenWithinMs: number,
  options?: { requireFullDetail?: boolean; minPhotos?: number },
): Promise<Set<string>> {
  if (sourceIds.length === 0 || skipIfSeenWithinMs <= 0) {
    return new Set();
  }

  const cutoff = new Date(Date.now() - skipIfSeenWithinMs);
  const rows = await db
    .select({
      sourceId: listingsTable.sourceId,
      listingId: listingsTable.id,
      vin: listingsTable.vin,
      mileage: listingsTable.mileage,
      photoCount: sql<number>`(
        SELECT count(*)::int FROM ${photosTable} WHERE ${photosTable.listingId} = ${listingsTable.id}
      )`,
      carsMirrorCount: sql<number>`(
        SELECT count(*)::int FROM ${photosTable}
        WHERE ${photosTable.listingId} = ${listingsTable.id}
          AND ${photosTable.sourceUrl} ~* 'cars2?\\.import-motor\\.com'
      )`,
    })
    .from(listingsTable)
    .where(
      and(
        eq(listingsTable.providerId, providerId),
        inArray(listingsTable.sourceId, sourceIds),
        gte(listingsTable.lastSeenAt, cutoff),
      ),
    );

  if (rows.length === 0) return new Set();

  // Never skip a recently-seen card that still lacks VIN + odometer — those
  // cars would otherwise be missed on a full re-crawl.
  const complete = rows.filter((r) => {
    const vin = String(r.vin ?? "").trim().toUpperCase();
    const mileage = r.mileage;
    return vin.length === 17 && typeof mileage === "number" && Number.isFinite(mileage) && mileage > 1;
  });

  let skipIds: Set<string>;
  if (!options?.requireFullDetail) {
    skipIds = new Set(complete.map((r) => r.sourceId));
  } else {
    const listingIds = complete.map((r) => r.listingId);
    if (listingIds.length === 0) return new Set();
    const fullRows = await db
      .select({ listingId: rawSourceRecordsTable.listingId })
      .from(rawSourceRecordsTable)
      .where(
        and(
          inArray(rawSourceRecordsTable.listingId, listingIds),
          sql`${rawSourceRecordsTable.rawJson} LIKE ${'%"detailLevel":"full"%'}`,
        ),
      );

    const hasFull = new Set(fullRows.map((r) => r.listingId).filter((id): id is number => id != null));
    skipIds = new Set(complete.filter((r) => hasFull.has(r.listingId)).map((r) => r.sourceId));
  }

  const minPhotos = options?.minPhotos ?? 0;
  if (minPhotos > 0) {
    for (const row of complete) {
      const photos = Number(row.photoCount ?? 0);
      const cars = Number(row.carsMirrorCount ?? 0);
      const carsOnly = cars > 0 && cars >= photos;
      if (photos < minPhotos || carsOnly) skipIds.delete(row.sourceId);
    }
  }

  return skipIds;
}

/** Source IDs already stored for this provider (any age). */
export async function findKnownSourceIds(
  providerId: number,
  sourceIds: string[],
): Promise<Set<string>> {
  if (sourceIds.length === 0) return new Set();
  const rows = await db
    .select({ sourceId: listingsTable.sourceId })
    .from(listingsTable)
    .where(
      and(
        eq(listingsTable.providerId, providerId),
        inArray(listingsTable.sourceId, sourceIds),
      ),
    );
  return new Set(rows.map((r) => r.sourceId));
}

/**
 * VINs already present in our vehicles table (unique index) — fast new-only skip.
 */
export async function findExistingVehicleVins(vins: string[]): Promise<Set<string>> {
  const clean = [...new Set(vins.map((v) => v.trim().toUpperCase()).filter((v) => v.length === 17))];
  if (clean.length === 0) return new Set();

  const rows = await db
    .select({ vin: vehiclesTable.vin })
    .from(vehiclesTable)
    .where(inArray(vehiclesTable.vin, clean));

  return new Set(rows.map((r) => String(r.vin ?? "").toUpperCase()).filter((v) => v.length === 17));
}

/**
 * VINs we already have completely enough to skip Import Motor detail re-fetch.
 * Requires VIN + mileage + a rich enough gallery so thin records still get upgraded.
 */
export async function findAlreadyCrawledImportMotorVins(vins: string[]): Promise<Set<string>> {
  const clean = [...new Set(vins.map((v) => v.trim().toUpperCase()).filter((v) => v.length === 17))];
  if (clean.length === 0) return new Set();

  const minPhotos = 8;

  const rows = await db
    .select({
      vin: vehiclesTable.vin,
      mileage: listingsTable.mileage,
      photoCount: sql<number>`(
        SELECT count(*)::int FROM ${photosTable}
        WHERE ${photosTable.listingId} = ${listingsTable.id}
           OR ${photosTable.vehicleId} = ${vehiclesTable.id}
      )`,
      carsOnlyCount: sql<number>`(
        SELECT count(*)::int FROM ${photosTable}
        WHERE (${photosTable.listingId} = ${listingsTable.id}
           OR ${photosTable.vehicleId} = ${vehiclesTable.id})
          AND ${photosTable.sourceUrl} ~* 'cars2?\\.import-motor\\.com'
      )`,
    })
    .from(vehiclesTable)
    .innerJoin(listingsTable, eq(listingsTable.vehicleId, vehiclesTable.id))
    .where(inArray(vehiclesTable.vin, clean));

  const complete = new Set<string>();
  for (const r of rows) {
    const vin = String(r.vin ?? "").toUpperCase();
    const mileage = r.mileage;
    const photos = Number(r.photoCount ?? 0);
    const carsOnly = Number(r.carsOnlyCount ?? 0);
    // Thin IM cars*.import-motor.com thumb packs must be re-fetched even if count looks "enough".
    const galleryOk = photos >= minPhotos && !(carsOnly > 0 && carsOnly >= photos);
    if (
      vin.length === 17 &&
      typeof mileage === "number" &&
      Number.isFinite(mileage) &&
      mileage > 1 &&
      galleryOk
    ) {
      complete.add(vin);
    }
  }

  // IM-sourced listings not yet linked to vehicles — still count if rich enough.
  const missing = clean.filter((v) => !complete.has(v));
  if (missing.length === 0) return complete;

  const byIm = await db
    .select({
      vin: listingsTable.vin,
      mileage: listingsTable.mileage,
      photoCount: sql<number>`(
        SELECT count(*)::int FROM ${photosTable} WHERE ${photosTable.listingId} = ${listingsTable.id}
      )`,
      carsOnlyCount: sql<number>`(
        SELECT count(*)::int FROM ${photosTable}
        WHERE ${photosTable.listingId} = ${listingsTable.id}
          AND ${photosTable.sourceUrl} ~* 'cars2?\\.import-motor\\.com'
      )`,
    })
    .from(listingsTable)
    .where(
      and(
        inArray(listingsTable.vin, missing),
        sql`${listingsTable.sourceId} LIKE 'im-%'`,
        sql`${listingsTable.mileage} IS NOT NULL AND ${listingsTable.mileage} > 1`,
      ),
    );

  for (const r of byIm) {
    const vin = String(r.vin ?? "").toUpperCase();
    const photos = Number(r.photoCount ?? 0);
    const carsOnly = Number(r.carsOnlyCount ?? 0);
    const galleryOk = photos >= minPhotos && !(carsOnly > 0 && carsOnly >= photos);
    if (vin.length === 17 && galleryOk) complete.add(vin);
  }
  return complete;
}
