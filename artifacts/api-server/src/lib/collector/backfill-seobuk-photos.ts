/**
 * Re-fetch Seobuk detail pages and replace junk gallery photos (logos/icons from old full-page scrape).
 * Run via: pnpm backfill:seobuk-photos [--dry-run] [--limit N] [--delay MS] [--vin VIN] [--listing-id ID]
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, listingsTable, photosTable, providersTable, vehiclesTable } from "@workspace/db";
import { storePhotos } from "./pipeline";
import { KrRequestError } from "../providers/kr-adapter";
import {
  isSeobukJunkPhoto,
  SeobukHistoricalAdapter,
  seobukDetailUrl,
} from "../providers/seobuk";

export interface SeobukPhotoBackfillOptions {
  dryRun?: boolean;
  /** Max listings to repair (default 500). */
  limit?: number;
  /** Pause between live fetches in ms (default 2500). */
  delayMs?: number;
  /** Repair a single listing row. */
  listingId?: number;
  /** Repair all Seobuk listings on this VIN. */
  vin?: string;
  /** When live fetch fails, delete junk rows only (keeps good photos). Default true. */
  purgeJunkOnFetchError?: boolean;
}

export interface SeobukPhotoBackfillStats {
  scannedListings: number;
  affectedListings: number;
  fetched: number;
  repaired: number;
  photosRemoved: number;
  photosAdded: number;
  photosPurged: number;
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
  junkCount: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseSeobukBackfillArgs(argv: string[]): SeobukPhotoBackfillOptions {
  const opts: SeobukPhotoBackfillOptions = {
    dryRun: false,
    limit: 500,
    delayMs: 2500,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--limit" && argv[i + 1]) opts.limit = Math.max(1, Number(argv[++i]) || 500);
    else if (arg === "--delay" && argv[i + 1]) opts.delayMs = Math.max(0, Number(argv[++i]) || 2500);
    else if (arg === "--listing-id" && argv[i + 1]) opts.listingId = Number(argv[++i]) || undefined;
    else if (arg === "--vin" && argv[i + 1]) opts.vin = String(argv[++i]).trim().toUpperCase() || undefined;
    else if (arg === "--no-purge-fallback") opts.purgeJunkOnFetchError = false;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: pnpm backfill:seobuk-photos [options]

  --dry-run           List affected listings only; no HTTP or DB writes
  --limit N           Max listings to repair (default 500)
  --delay MS          Pause between fetches (default 2500)
  --listing-id ID     Repair one listing row
  --vin VIN           Repair Seobuk listings for one VIN
  --no-purge-fallback Skip deleting junk rows when live fetch fails

Requires KR_PROXY or ENCAR_PROXY if Seobuk blocks your IP (403).
`);
      process.exit(0);
    }
  }

  return opts;
}

async function findAffectedListings(opts: SeobukPhotoBackfillOptions): Promise<AffectedListing[]> {
  const [provider] = await db
    .select({ id: providersTable.id })
    .from(providersTable)
    .where(eq(providersTable.internalName, "seobuk"))
    .limit(1);

  if (!provider) return [];

  const filters = [eq(listingsTable.providerId, provider.id), sql`${listingsTable.vehicleId} IS NOT NULL`];
  if (opts.listingId != null) filters.push(eq(listingsTable.id, opts.listingId));
  if (opts.vin) filters.push(eq(vehiclesTable.vin, opts.vin));

  const rows = await db
    .select({
      listingId: listingsTable.id,
      vehicleId: listingsTable.vehicleId,
      sourceId: listingsTable.sourceId,
      sourceUrl: listingsTable.sourceUrl,
      vin: vehiclesTable.vin,
      photoId: photosTable.id,
      photoUrl: photosTable.sourceUrl,
    })
    .from(listingsTable)
    .innerJoin(vehiclesTable, eq(listingsTable.vehicleId, vehiclesTable.id))
    .innerJoin(photosTable, eq(photosTable.listingId, listingsTable.id))
    .where(and(...filters));

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
        junkCount: 0,
      };
      byListing.set(row.listingId, entry);
    }
    entry.photos.push({ id: row.photoId, url: row.photoUrl });
    if (isSeobukJunkPhoto(row.photoUrl)) entry.junkCount++;
  }

  const affected = [...byListing.values()]
    .filter((entry) => entry.junkCount > 0)
    .sort((a, b) => b.junkCount - a.junkCount || a.listingId - b.listingId);

  const cap = opts.limit ?? 500;
  return affected.slice(0, cap);
}

async function repairListing(
  listing: AffectedListing,
  adapter: SeobukHistoricalAdapter,
  dryRun: boolean,
): Promise<{ removed: number; added: number; error?: string }> {
  const detailUrl = listing.sourceUrl?.trim() || seobukDetailUrl(listing.sourceId);

  if (dryRun) {
    return { removed: listing.photos.length, added: 0 };
  }

  const fetched = await adapter.fetchListing(detailUrl);
  const parsed = await adapter.parseListing(fetched);
  const newPhotos = parsed.photos ?? [];

  if (newPhotos.length === 0) {
    return { removed: 0, added: 0, error: "no_photos_parsed" };
  }

  const stillJunk = newPhotos.filter((p) => isSeobukJunkPhoto(p.sourceUrl)).length;
  if (stillJunk === newPhotos.length) {
    return { removed: 0, added: 0, error: "parse_still_junk_only" };
  }

  const removedRows = await db
    .delete(photosTable)
    .where(eq(photosTable.listingId, listing.listingId))
    .returning({ id: photosTable.id });

  await storePhotos(listing.vehicleId, listing.listingId, newPhotos);

  return { removed: removedRows.length, added: newPhotos.length };
}

async function purgeJunkPhotosForListing(listing: AffectedListing): Promise<number> {
  const junkIds = listing.photos.filter((p) => isSeobukJunkPhoto(p.url)).map((p) => p.id);
  if (junkIds.length === 0) return 0;
  const removed = await db
    .delete(photosTable)
    .where(inArray(photosTable.id, junkIds))
    .returning({ id: photosTable.id });
  if (removed.length > 0) {
    scheduleVehiclePhotoMirrorAfterPurge(listing.vehicleId);
  }
  return removed.length;
}

/** Re-queue R2 mirror after photo row deletes (import lazily to avoid circular deps). */
function scheduleVehiclePhotoMirrorAfterPurge(vehicleId: number): void {
  void import("../photo-mirror")
    .then(({ scheduleVehiclePhotoMirror }) => scheduleVehiclePhotoMirror(vehicleId))
    .catch(() => undefined);
}

export async function backfillSeobukPhotos(
  options: SeobukPhotoBackfillOptions = {},
): Promise<SeobukPhotoBackfillStats> {
  const dryRun = Boolean(options.dryRun);
  const delayMs = options.delayMs ?? 2500;
  const purgeOnError = options.purgeJunkOnFetchError !== false;
  const adapter = new SeobukHistoricalAdapter();

  const affected = await findAffectedListings(options);
  const stats: SeobukPhotoBackfillStats = {
    scannedListings: affected.length,
    affectedListings: affected.length,
    fetched: 0,
    repaired: 0,
    photosRemoved: 0,
    photosAdded: 0,
    photosPurged: 0,
    errors: 0,
    skipped: 0,
    dryRun,
  };

  for (let i = 0; i < affected.length; i++) {
    const listing = affected[i]!;
    const label = listing.vin ?? listing.sourceId;
    const progress = `[${i + 1}/${affected.length}]`;

    if (dryRun) {
      console.log(
        `${progress} listing ${listing.listingId} VIN ${label}: ${listing.junkCount}/${listing.photos.length} junk photos`,
      );
      stats.photosRemoved += listing.photos.length;
      continue;
    }

    try {
      console.log(
        `${progress} Re-crawling ${label} (${listing.junkCount} junk / ${listing.photos.length} photos)…`,
      );
      stats.fetched++;
      const result = await repairListing(listing, adapter, false);
      if (result.error) {
        stats.errors++;
        console.warn(`  skip: ${result.error}`);
        continue;
      }
      stats.repaired++;
      stats.photosRemoved += result.removed;
      stats.photosAdded += result.added;
      console.log(`  replaced ${result.removed} → ${result.added} photos`);
    } catch (err) {
      stats.errors++;
      const msg =
        err instanceof KrRequestError
          ? `HTTP ${err.statusCode} ${err.url}`
          : err instanceof Error
            ? err.message
            : String(err);
      console.warn(`  error: ${msg}`);
      if (purgeOnError && listing.junkCount > 0) {
        try {
          const purged = await purgeJunkPhotosForListing(listing);
          if (purged > 0) {
            stats.photosPurged += purged;
            stats.photosRemoved += purged;
            console.warn(`  fallback: purged ${purged} junk photo(s) (live fetch failed)`);
          }
        } catch (purgeErr) {
          console.warn(
            `  purge failed: ${purgeErr instanceof Error ? purgeErr.message : String(purgeErr)}`,
          );
        }
      }
    }

    if (delayMs > 0 && i < affected.length - 1) {
      await sleep(delayMs);
    }
  }

  return stats;
}
