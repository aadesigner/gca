import { db, listingsTable, rawSourceRecordsTable } from "@workspace/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

/**
 * Returns sourceIds that were collected recently for this provider.
 * Used to skip expensive detail fetches on re-crawls.
 */
export async function findRecentlySeenSourceIds(
  providerId: number,
  sourceIds: string[],
  skipIfSeenWithinMs: number,
  options?: { requireFullDetail?: boolean },
): Promise<Set<string>> {
  if (sourceIds.length === 0 || skipIfSeenWithinMs <= 0) {
    return new Set();
  }

  const cutoff = new Date(Date.now() - skipIfSeenWithinMs);
  const rows = await db
    .select({
      sourceId: listingsTable.sourceId,
      listingId: listingsTable.id,
    })
    .from(listingsTable)
    .where(
      and(
        eq(listingsTable.providerId, providerId),
        inArray(listingsTable.sourceId, sourceIds),
        gte(listingsTable.lastSeenAt, cutoff),
      ),
    );

  if (!options?.requireFullDetail || rows.length === 0) {
    return new Set(rows.map((r) => r.sourceId));
  }

  const listingIds = rows.map((r) => r.listingId);
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
  return new Set(rows.filter((r) => hasFull.has(r.listingId)).map((r) => r.sourceId));
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
 * VINs already fetched from Import Motor (any persist provider with IM URL / im- source id).
 * Used to skip detail re-fetch when rescanning country lists.
 */
export async function findAlreadyCrawledImportMotorVins(vins: string[]): Promise<Set<string>> {
  const clean = [...new Set(vins.map((v) => v.trim().toUpperCase()).filter((v) => v.length === 17))];
  if (clean.length === 0) return new Set();

  const rows = await db
    .select({ vin: listingsTable.vin })
    .from(listingsTable)
    .where(
      and(
        inArray(listingsTable.vin, clean),
        sql`(
          ${listingsTable.sourceUrl} ILIKE '%import-motor.com/v/%'
          OR ${listingsTable.sourceId} LIKE 'im-%'
        )`,
      ),
    );

  return new Set(rows.map((r) => String(r.vin ?? "").toUpperCase()).filter((v) => v.length === 17));
}
