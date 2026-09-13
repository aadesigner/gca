/**
 * Re-fetch Import Motor detail pages and restore full VIN galleries
 * (cars2 mirrors + IAAI resizer frames rewritten from deepzoom).
 *
 * Run via: pnpm backfill:import-motor-photos [--dry-run] [--limit N] [--delay MS]
 *   [--vin VIN] [--listing-id ID] [--min-photos N] [--since-days N]
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, listingsTable, photosTable, vehiclesTable } from "@workspace/db";
import { storeEvents, storePhotos, upsertVehicle } from "./pipeline";
import { isJunkPhotoUrl } from "../providers/web-html";
import { ImportMotorHistoricalAdapter } from "../providers/import-motor";
import { IMPORT_MOTOR_WEB_BASE } from "../providers/import-motor-parse";
import { logger } from "../logger";

export interface ImportMotorPhotoBackfillOptions {
  dryRun?: boolean;
  /** Max listings to repair (default 400). */
  limit?: number;
  /** Pause between live fetches in ms (default 800). */
  delayMs?: number;
  listingId?: number;
  vin?: string;
  /** Re-fetch every IM listing, not only thin galleries. */
  all?: boolean;
  /** Listings with fewer photos than this are repaired (default 10). */
  minPhotos?: number;
  /** Only listings last seen within this many days (default 21). 0 = no age filter. */
  sinceDays?: number;
}

export interface ImportMotorPhotoBackfillStats {
  scannedListings: number;
  affectedListings: number;
  fetched: number;
  repaired: number;
  photosAdded: number;
  errors: number;
  skipped: number;
  dryRun: boolean;
}

type PhotoRow = { id: number; url: string };

type AffectedListing = {
  listingId: number;
  vehicleId: number;
  sourceId: string;
  sourceUrl: string | null;
  vin: string | null;
  photos: PhotoRow[];
  realCount: number;
  lastSeenAt: Date | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseImportMotorBackfillArgs(argv: string[]): ImportMotorPhotoBackfillOptions {
  const opts: ImportMotorPhotoBackfillOptions = {
    dryRun: false,
    limit: 400,
    delayMs: 800,
    minPhotos: 10,
    sinceDays: 21,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--all") opts.all = true;
    else if (arg === "--limit" && argv[i + 1]) opts.limit = Math.max(1, Number(argv[++i]) || 400);
    else if (arg === "--delay" && argv[i + 1]) opts.delayMs = Math.max(0, Number(argv[++i]) || 800);
    else if (arg === "--min-photos" && argv[i + 1]) opts.minPhotos = Math.max(1, Number(argv[++i]) || 10);
    else if (arg === "--since-days" && argv[i + 1]) opts.sinceDays = Math.max(0, Number(argv[++i]) || 0);
    else if (arg === "--listing-id" && argv[i + 1]) opts.listingId = Number(argv[++i]) || undefined;
    else if (arg === "--vin" && argv[i + 1]) opts.vin = String(argv[++i]).trim().toUpperCase() || undefined;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: pnpm backfill:import-motor-photos [options]

  --dry-run           List affected listings only; no HTTP or DB writes
  --all               Re-fetch every IM listing (not only thin galleries)
  --limit N           Max listings to repair (default 400)
  --delay MS          Pause between fetches (default 800)
  --min-photos N      Re-fetch when gallery count is below N (default 10)
  --since-days N      Only listings last seen within N days (default 21; 0 = all ages)
  --listing-id ID     Repair one listing row
  --vin VIN           Repair Import Motor listings for one VIN
`);
      process.exit(0);
    }
  }

  return opts;
}

async function findAffectedListings(opts: ImportMotorPhotoBackfillOptions): Promise<AffectedListing[]> {
  const filters = [
    sql`${listingsTable.vehicleId} IS NOT NULL`,
    // IM-sourced rows may be stored under import_motor, copart, or iaa providers.
    sql`(${listingsTable.sourceId} LIKE 'im-%' OR ${listingsTable.sourceUrl} ILIKE '%import-motor.com/v/%')`,
  ];
  if (opts.listingId != null) filters.push(eq(listingsTable.id, opts.listingId));
  if (opts.vin) filters.push(eq(vehiclesTable.vin, opts.vin));
  if ((opts.sinceDays ?? 0) > 0 && opts.vin == null && opts.listingId == null) {
    const since = new Date(Date.now() - opts.sinceDays! * 86_400_000);
    filters.push(gte(listingsTable.lastSeenAt, since));
  }

  const rows = await db
    .select({
      listingId: listingsTable.id,
      vehicleId: listingsTable.vehicleId,
      sourceId: listingsTable.sourceId,
      sourceUrl: listingsTable.sourceUrl,
      vin: vehiclesTable.vin,
      lastSeenAt: listingsTable.lastSeenAt,
      photoId: photosTable.id,
      photoUrl: photosTable.sourceUrl,
    })
    .from(listingsTable)
    .innerJoin(vehiclesTable, eq(listingsTable.vehicleId, vehiclesTable.id))
    .leftJoin(photosTable, eq(photosTable.listingId, listingsTable.id))
    .where(and(...filters))
    .orderBy(sql`${listingsTable.lastSeenAt} DESC NULLS LAST`);

  const byListing = new Map<number, AffectedListing>();
  for (const row of rows) {
    if (row.vehicleId == null) continue;
    let entry = byListing.get(row.listingId);
    if (!entry) {
      entry = {
        listingId: row.listingId,
        vehicleId: row.vehicleId,
        sourceId: row.sourceId,
        sourceUrl: row.sourceUrl,
        vin: row.vin,
        photos: [],
        realCount: 0,
        lastSeenAt: row.lastSeenAt,
      };
      byListing.set(row.listingId, entry);
    }
    if (row.photoId != null && row.photoUrl) {
      entry.photos.push({ id: row.photoId, url: row.photoUrl });
      if (!isJunkPhotoUrl(row.photoUrl)) entry.realCount += 1;
    }
  }

  const minPhotos = opts.minPhotos ?? 10;
  const all = Boolean(opts.all) || opts.vin != null || opts.listingId != null;
  const affected = [...byListing.values()]
    .filter((l) => {
      if (all) return true;
      if (l.realCount < minPhotos) return true;
      // Also rewrite galleries that still mix IM mirrors with auction CDN (dup UI).
      const hasCars = l.photos.some((p) => /cars2?\.import-motor\.com/i.test(p.url));
      const hasAuction = l.photos.some(
        (p) =>
          /vis\.iaai\.com\/resizer/i.test(p.url) ||
          /cs\.copart\.com/i.test(p.url) ||
          /ci\.encar\.com/i.test(p.url),
      );
      return hasCars && hasAuction;
    })
    .slice(0, opts.limit ?? 400);

  return affected;
}

function detailUrlFor(listing: AffectedListing): string {
  const fromRow = listing.sourceUrl?.trim();
  if (fromRow && /^https?:\/\//i.test(fromRow)) return fromRow;
  const vin = (listing.vin || listing.sourceId.replace(/^im-/i, "")).toUpperCase();
  return `${IMPORT_MOTOR_WEB_BASE}/v/${vin}`;
}

async function stripCarsMirrorsIfAuctionPresent(listingId: number): Promise<number> {
  const rows = await db
    .select({ id: photosTable.id, url: photosTable.sourceUrl })
    .from(photosTable)
    .where(eq(photosTable.listingId, listingId));
  const hasAuction = rows.some(
    (r) =>
      /vis\.iaai\.com\/resizer/i.test(r.url) ||
      /cs\.copart\.com/i.test(r.url) ||
      /ci\.encar\.com/i.test(r.url),
  );
  if (!hasAuction) return 0;
  const junkIds = rows.filter((r) => /cars2?\.import-motor\.com/i.test(r.url)).map((r) => r.id);
  if (junkIds.length === 0) return 0;
  const removed = await db
    .delete(photosTable)
    .where(inArray(photosTable.id, junkIds))
    .returning({ id: photosTable.id });
  return removed.length;
}

async function repairListing(
  listing: AffectedListing,
  adapter: ImportMotorHistoricalAdapter,
  dryRun: boolean,
): Promise<{ added: number; error?: string; parsedCount?: number }> {
  const detailUrl = detailUrlFor(listing);

  if (dryRun) {
    return { added: 0, parsedCount: 0 };
  }

  const beforeIds = new Set(listing.photos.map((p) => p.id));
  const fetched = await adapter.fetchListing(detailUrl);
  const parsed = await adapter.parseListing(fetched);
  const usable = (parsed.photos ?? []).filter((p) => p?.sourceUrl && !isJunkPhotoUrl(p.sourceUrl));

  if (usable.length === 0) {
    const removed = await stripCarsMirrorsIfAuctionPresent(listing.listingId);
    if (removed > 0) {
      return { added: 0, parsedCount: 0 };
    }
    return { added: 0, error: "no_photos_parsed", parsedCount: 0 };
  }

  // Always rewrite on targeted/--all runs so stale cars2+CDN duplicates get replaced.
  const force = true;

  if (!force && usable.length <= listing.realCount) {
    return { added: 0, parsedCount: usable.length, error: "no_richer_gallery" };
  }

  if (listing.vin && parsed.vehicle) {
    await upsertVehicle(listing.vin, parsed.vehicle, parsed.mileage, undefined, parsed.mileageUnit);
  }
  await storeEvents(listing.vehicleId, parsed);
  await storePhotos(listing.vehicleId, listing.listingId, usable);

  const after = await db
    .select({ id: photosTable.id })
    .from(photosTable)
    .where(eq(photosTable.listingId, listing.listingId));
  const added = after.filter((row) => !beforeIds.has(row.id)).length;

  void import("../photo-mirror")
    .then(({ scheduleVehiclePhotoMirror }) => scheduleVehiclePhotoMirror(listing.vehicleId))
    .catch(() => undefined);

  return { added, parsedCount: usable.length };
}

let backfillAbort = false;
export function abortImportMotorPhotoBackfill(): void {
  backfillAbort = true;
}

export async function backfillImportMotorPhotos(
  options: ImportMotorPhotoBackfillOptions = {},
): Promise<ImportMotorPhotoBackfillStats> {
  backfillAbort = false;
  const dryRun = Boolean(options.dryRun);
  const delayMs = options.delayMs ?? 800;
  const adapter = new ImportMotorHistoricalAdapter();

  const affected = await findAffectedListings(options);
  const stats: ImportMotorPhotoBackfillStats = {
    scannedListings: affected.length,
    affectedListings: affected.length,
    fetched: 0,
    repaired: 0,
    photosAdded: 0,
    errors: 0,
    skipped: 0,
    dryRun,
  };

  for (let i = 0; i < affected.length; i++) {
    if (backfillAbort) {
      console.warn("Import Motor photo backfill aborted");
      break;
    }
    const listing = affected[i]!;
    const label = listing.vin ?? listing.sourceId;
    const progress = `[${i + 1}/${affected.length}]`;
    console.log(
      `${progress} ${label} listing=${listing.listingId} photos=${listing.realCount} → fetch ${detailUrlFor(listing)}`,
    );

    if (dryRun) {
      stats.skipped++;
      continue;
    }

    try {
      stats.fetched++;
      const result = await repairListing(listing, adapter, false);
      if (result.error === "no_richer_gallery") {
        stats.skipped++;
        console.log(`  skip: parsed ${result.parsedCount ?? 0} (not richer than ${listing.realCount})`);
      } else if (result.error) {
        stats.errors++;
        console.warn(`  error: ${result.error}`);
      } else {
        stats.repaired++;
        stats.photosAdded += result.added;
        console.log(`  repaired +${result.added} (parsed ${result.parsedCount ?? 0})`);
      }
    } catch (err) {
      stats.errors++;
      logger.warn({ err, listingId: listing.listingId, vin: listing.vin }, "IM photo backfill failed");
      console.warn(`  error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (delayMs > 0 && i + 1 < affected.length) await sleep(delayMs);
  }

  return stats;
}
