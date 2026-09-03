/**
 * Re-fetch Seobuk detail pages and restore full VIN galleries.
 * Run via: pnpm backfill:seobuk-photos [--dry-run] [--limit N] [--delay MS] [--vin VIN] [--listing-id ID]
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, listingsTable, photosTable, providersTable, vehiclesTable } from "@workspace/db";
import { storeEvents, storePhotos, upsertVehicle } from "./pipeline";
import { KrRequestError } from "../providers/kr-adapter";
import {
  fetchSeobukImageList,
  isSeobukJunkPhoto,
  SeobukHistoricalAdapter,
  seobukDetailUrl,
} from "../providers/seobuk";
import { logger } from "../logger";

export interface SeobukPhotoBackfillOptions {
  dryRun?: boolean;
  /** Max listings to repair (default 600). */
  limit?: number;
  /** Pause between live fetches in ms (default 2000). */
  delayMs?: number;
  /** Repair a single listing row. */
  listingId?: number;
  /** Repair all Seobuk listings on this VIN. */
  vin?: string;
  /** Re-fetch every Seobuk listing, not only thin/junk galleries. */
  all?: boolean;
  /** Listings with fewer real photos than this are repaired (default 8). */
  minPhotos?: number;
  /** When live fetch fails, delete real junk rows only (never gallery URLs). Default true. */
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
  realCount: number;
  vehiclePhotoCount: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseSeobukBackfillArgs(argv: string[]): SeobukPhotoBackfillOptions {
  const opts: SeobukPhotoBackfillOptions = {
    dryRun: false,
    limit: 600,
    delayMs: 2000,
    minPhotos: 8,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--all") opts.all = true;
    else if (arg === "--limit" && argv[i + 1]) opts.limit = Math.max(1, Number(argv[++i]) || 600);
    else if (arg === "--delay" && argv[i + 1]) opts.delayMs = Math.max(0, Number(argv[++i]) || 2000);
    else if (arg === "--min-photos" && argv[i + 1]) opts.minPhotos = Math.max(1, Number(argv[++i]) || 8);
    else if (arg === "--listing-id" && argv[i + 1]) opts.listingId = Number(argv[++i]) || undefined;
    else if (arg === "--vin" && argv[i + 1]) opts.vin = String(argv[++i]).trim().toUpperCase() || undefined;
    else if (arg === "--no-purge-fallback") opts.purgeJunkOnFetchError = false;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: pnpm backfill:seobuk-photos [options]

  --dry-run           List affected listings only; no HTTP or DB writes
  --all               Re-fetch every Seobuk listing (not only thin galleries)
  --limit N           Max listings to repair (default 600)
  --delay MS          Pause between fetches (default 2000)
  --min-photos N      Re-fetch when real gallery count is below N (default 8)
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
      vehiclePhotoCount: sql<number>`(
        SELECT count(*)::int FROM ${photosTable} p2 WHERE p2.vehicle_id = ${listingsTable.vehicleId}
      )`,
    })
    .from(listingsTable)
    .innerJoin(vehiclesTable, eq(listingsTable.vehicleId, vehiclesTable.id))
    .leftJoin(photosTable, eq(photosTable.listingId, listingsTable.id))
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
        realCount: 0,
        vehiclePhotoCount: Number(row.vehiclePhotoCount ?? 0),
      };
      byListing.set(row.listingId, entry);
    }
    if (row.photoId == null || !row.photoUrl) continue;
    entry.photos.push({ id: row.photoId, url: row.photoUrl });
    if (isSeobukJunkPhoto(row.photoUrl)) entry.junkCount++;
    else entry.realCount++;
  }

  const targeted = opts.listingId != null || Boolean(opts.vin);
  const minPhotos = opts.minPhotos ?? 8;
  const affected = [...byListing.values()]
    .filter((entry) => {
      if (targeted || opts.all) return true;
      // Repair thin Seobuk listing galleries even when another provider already
      // filled the VIN (dual-listed) — catalog export is per-listing.
      return entry.realCount < minPhotos;
    })
    .sort(
      (a, b) =>
        a.realCount - b.realCount ||
        a.vehiclePhotoCount - b.vehiclePhotoCount ||
        b.junkCount - a.junkCount ||
        a.listingId - b.listingId,
    );

  const cap = opts.limit ?? 600;
  return affected.slice(0, cap);
}

async function repairListing(
  listing: AffectedListing,
  adapter: SeobukHistoricalAdapter,
  dryRun: boolean,
): Promise<{ removed: number; added: number; error?: string }> {
  const detailUrl = listing.sourceUrl?.trim() || seobukDetailUrl(listing.sourceId);

  if (dryRun) {
    return { removed: listing.junkCount, added: 0 };
  }

  const beforeIds = new Set(listing.photos.map((p) => p.id));

  // Prefer /search/imageList alone (one POST) — full gallery without HTML detail.
  const apiUrls = (await fetchSeobukImageList(listing.sourceId)).filter(
    (url) => !isSeobukJunkPhoto(url),
  );
  if (apiUrls.length >= 2) {
    const usable = apiUrls.slice(0, 40).map((sourceUrl, index) => ({
      sourceUrl,
      isPrimary: index === 0,
      sortOrder: index,
    }));
    await storePhotos(listing.vehicleId, listing.listingId, usable);
    const after = await db
      .select({ id: photosTable.id, url: photosTable.sourceUrl })
      .from(photosTable)
      .where(eq(photosTable.listingId, listing.listingId));
    const added = after.filter((row) => !beforeIds.has(row.id)).length;
    const purged = await purgeJunkPhotosForListing({
      ...listing,
      photos: after.map((row) => ({ id: row.id, url: row.url })),
    });
    return { removed: purged, added };
  }

  const fetched = await adapter.fetchListing(detailUrl);
  const parsed = await adapter.parseListing(fetched);
  const newPhotos = parsed.photos ?? [];
  const usable = newPhotos.filter((p) => !isSeobukJunkPhoto(p.sourceUrl));

  if (usable.length === 0) {
    return { removed: 0, added: 0, error: "no_photos_parsed" };
  }

  if (listing.vin && parsed.vehicle) {
    await upsertVehicle(listing.vin, parsed.vehicle, parsed.mileage, undefined, parsed.mileageUnit);
  }
  await storeEvents(listing.vehicleId, parsed);

  await storePhotos(listing.vehicleId, listing.listingId, usable);

  const after = await db
    .select({ id: photosTable.id, url: photosTable.sourceUrl })
    .from(photosTable)
    .where(eq(photosTable.listingId, listing.listingId));
  const added = after.filter((row) => !beforeIds.has(row.id)).length;

  const purged = await purgeJunkPhotosForListing({
    ...listing,
    photos: after.map((row) => ({ id: row.id, url: row.url })),
  });

  return { removed: purged, added };
}

async function purgeJunkPhotosForListing(listing: {
  vehicleId: number;
  photos: PhotoRow[];
}): Promise<number> {
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
  const delayMs = options.delayMs ?? 2000;
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
    if (backfillAbort) {
      console.warn("Seobuk photo backfill aborted");
      break;
    }
    const listing = affected[i]!;
    const label = listing.vin ?? listing.sourceId;
    const progress = `[${i + 1}/${affected.length}]`;

    if (dryRun) {
      console.log(
        `${progress} listing ${listing.listingId} VIN ${label}: listing=${listing.realCount} vehicle=${listing.vehiclePhotoCount} junk=${listing.junkCount}`,
      );
      continue;
    }

    try {
      console.log(
        `${progress} Re-crawling ${label} (listing ${listing.realCount} / vehicle ${listing.vehiclePhotoCount})…`,
      );
      stats.fetched++;
      const result = await repairListing(listing, adapter, false);
      if (result.error) {
        stats.errors++;
        stats.skipped++;
        console.warn(`  skip: ${result.error}`);
        if (purgeOnError && listing.junkCount > 0) {
          const purged = await purgeJunkPhotosForListing(listing);
          if (purged > 0) {
            stats.photosPurged += purged;
            stats.photosRemoved += purged;
            console.warn(`  fallback: purged ${purged} junk photo(s)`);
          }
        }
        if (backfillRun.running) backfillRun.stats = { ...stats };
        continue;
      }
      stats.repaired++;
      stats.photosRemoved += result.removed;
      stats.photosAdded += result.added;
      console.log(`  merged +${result.added} photos (purged ${result.removed} junk)`);
      if (backfillRun.running) backfillRun.stats = { ...stats };
    } catch (err) {
      stats.errors++;
      const msg =
        err instanceof KrRequestError
          ? `HTTP ${err.statusCode} ${err.url}`
          : err instanceof Error
            ? err.message
            : String(err);
      console.warn(`  error: ${msg}`);
      const blocked =
        err instanceof KrRequestError &&
        (err.statusCode === 403 || /IP blocked/i.test(err.message));
      if (blocked) {
        // Cool down so Seobuk unblocks the host IP instead of burning the queue.
        console.warn("  Seobuk IP block — cooling 90s before next listing");
        await sleep(90_000);
      }
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
      if (backfillRun.running) backfillRun.stats = { ...stats };
    }

    if (delayMs > 0 && i < affected.length - 1) {
      await sleep(delayMs);
    }
  }

  return stats;
}

type BackfillRunState = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  stats: SeobukPhotoBackfillStats | null;
};

const backfillRun: BackfillRunState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  error: null,
  stats: null,
};

let backfillAbort = false;

export function getSeobukPhotoBackfillStatus(): BackfillRunState {
  return { ...backfillRun };
}

export function stopSeobukPhotoBackfill(): boolean {
  if (!backfillRun.running) return false;
  backfillAbort = true;
  return true;
}

export function startSeobukPhotoBackfill(options: SeobukPhotoBackfillOptions = {}): boolean {
  if (backfillRun.running) return false;
  backfillAbort = false;
  backfillRun.running = true;
  backfillRun.startedAt = new Date().toISOString();
  backfillRun.finishedAt = null;
  backfillRun.error = null;
  backfillRun.stats = {
    scannedListings: 0,
    affectedListings: 0,
    fetched: 0,
    repaired: 0,
    photosRemoved: 0,
    photosAdded: 0,
    photosPurged: 0,
    errors: 0,
    skipped: 0,
    dryRun: false,
  };
  logger.info({ options }, "Seobuk photo backfill started");
  void backfillSeobukPhotos({ ...options, dryRun: false })
    .then((stats) => {
      backfillRun.stats = stats;
      logger.info(stats, "Seobuk photo backfill finished");
    })
    .catch((err) => {
      backfillRun.error = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, "Seobuk photo backfill failed");
    })
    .finally(() => {
      backfillRun.running = false;
      backfillRun.finishedAt = new Date().toISOString();
      backfillAbort = false;
    });
  return true;
}
