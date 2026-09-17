/**
 * Re-fetch Import Motor detail pages and restore full VIN galleries
 * (cars2 mirrors + IAAI resizer frames rewritten from deepzoom).
 *
 * Run via: pnpm backfill:import-motor-photos [--dry-run] [--limit N] [--delay MS]
 *   [--vin VIN] [--listing-id ID] [--min-photos N] [--since-days N]
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db, photosTable, pool } from "@workspace/db";
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
    minPhotos: 8,
    /** Default: all ages — thin cars-mirror galleries are often old inactive lots. */
    sinceDays: 0,
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
  --min-photos N      Re-fetch when gallery count is below N (default 8)
  --since-days N      Only listings last seen within N days (default 0 = all ages)
  --listing-id ID     Repair one listing row
  --vin VIN           Repair Import Motor listings for one VIN
`);
      process.exit(0);
    }
  }

  return opts;
}

async function findAffectedListings(opts: ImportMotorPhotoBackfillOptions): Promise<AffectedListing[]> {
  const minPhotos = opts.minPhotos ?? 8;
  const limit = opts.limit ?? 400;
  const all = Boolean(opts.all) || opts.vin != null || opts.listingId != null;

  const filters = [
    sql`pr.internal_name = 'import_motor'`,
    sql`l.vehicle_id IS NOT NULL`,
  ];
  if (opts.listingId != null) filters.push(sql`l.id = ${opts.listingId}`);
  if (opts.vin) filters.push(sql`v.vin = ${opts.vin}`);
  if ((opts.sinceDays ?? 0) > 0 && opts.vin == null && opts.listingId == null) {
    const since = new Date(Date.now() - opts.sinceDays! * 86_400_000);
    filters.push(sql`l.last_seen_at >= ${since}`);
  }

  // Phase 1: candidate IM rows only (no correlated photo scans — those timeout on big DBs).
  // Oversample so after thin-filter we still fill `limit`.
  const candidateLimit =
    opts.listingId != null || opts.vin != null ? Math.max(limit, 50) : Math.min(Math.max(limit * 50, 2_500), 12_000);

  const candidateResult = await db.execute(sql`
    SELECT
      l.id AS listing_id,
      l.vehicle_id AS vehicle_id,
      l.source_id AS source_id,
      l.source_url AS source_url,
      v.vin AS vin,
      l.last_seen_at AS last_seen_at
    FROM listings l
    INNER JOIN providers pr ON pr.id = l.provider_id
    INNER JOIN vehicles v ON v.id = l.vehicle_id
    WHERE ${sql.join(filters, sql` AND `)}
    ORDER BY l.last_seen_at DESC NULLS LAST
    LIMIT ${candidateLimit}
  `);

  const listingRows = Array.isArray(candidateResult)
    ? (candidateResult as Array<Record<string, unknown>>)
    : ((candidateResult as { rows?: Array<Record<string, unknown>> }).rows ?? []);

  if (listingRows.length === 0) return [];

  const listingIds = listingRows.map((r) => Number(r.listing_id));

  // Phase 2: one GROUP BY over the candidate ids only (ANY avoids 12k SQL params).
  const statsResult = await pool.query<{
    listing_id: number;
    real_count: number;
    has_cars_mirror: boolean;
  }>(
    `
    SELECT
      p.listing_id AS listing_id,
      count(*) FILTER (
        WHERE p.source_url IS NOT NULL
          AND p.source_url !~* '(placeholder|no[_-]?photo|1x1\\.gif)'
      )::int AS real_count,
      bool_or(p.source_url ~* 'cars2?\\.import-motor\\.com') AS has_cars_mirror
    FROM photos p
    WHERE p.listing_id = ANY($1::int[])
    GROUP BY p.listing_id
    `,
    [listingIds],
  );

  const statsByListing = new Map<number, { realCount: number; hasCarsMirror: boolean }>();
  for (const row of statsResult.rows) {
    statsByListing.set(Number(row.listing_id), {
      realCount: Number(row.real_count ?? 0),
      hasCarsMirror: Boolean(row.has_cars_mirror),
    });
  }

  const thinRows = all
    ? listingRows
    : listingRows.filter((r) => {
        const st = statsByListing.get(Number(r.listing_id));
        const realCount = st?.realCount ?? 0;
        return realCount < minPhotos || Boolean(st?.hasCarsMirror);
      });

  const selected = thinRows.slice(0, limit);
  if (selected.length === 0) return [];

  const selectedIds = selected.map((r) => Number(r.listing_id));
  const photoRows = await db
    .select({
      id: photosTable.id,
      listingId: photosTable.listingId,
      url: photosTable.sourceUrl,
    })
    .from(photosTable)
    .where(inArray(photosTable.listingId, selectedIds));

  const photosByListing = new Map<number, PhotoRow[]>();
  for (const p of photoRows) {
    if (p.listingId == null || !p.url) continue;
    const list = photosByListing.get(p.listingId) ?? [];
    list.push({ id: p.id, url: p.url });
    photosByListing.set(p.listingId, list);
  }

  return selected.map((r) => {
    const photos = photosByListing.get(Number(r.listing_id)) ?? [];
    return {
      listingId: Number(r.listing_id),
      vehicleId: Number(r.vehicle_id),
      sourceId: String(r.source_id),
      sourceUrl: (r.source_url as string | null) ?? null,
      vin: (r.vin as string | null) ?? null,
      photos,
      realCount: photos.filter((p) => !isJunkPhotoUrl(p.url)).length,
      lastSeenAt: (r.last_seen_at as Date | null) ?? null,
    };
  });
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
  const expectedVin = (listing.vin || "").toUpperCase();
  const landedVin = String(fetched.url || "")
    .match(/\/v\/([A-HJ-NPR-Z0-9]{17})/i)?.[1]
    ?.toUpperCase();
  if (expectedVin && landedVin && landedVin !== expectedVin) {
    return {
      added: 0,
      parsedCount: 0,
      error: `redirected_to_other_vin=${landedVin}`,
    };
  }
  const parsed = await adapter.parseListing(fetched);
  let usable = (parsed.photos ?? []).filter((p) => p?.sourceUrl && !isJunkPhotoUrl(p.sourceUrl));

  const parsedVin = (parsed.vehicle?.vin || "").toUpperCase();
  if (expectedVin && parsedVin && parsedVin !== expectedVin) {
    return {
      added: 0,
      parsedCount: usable.length,
      error: `vin_mismatch_page=${parsedVin}`,
    };
  }
  // Never store frames whose URL embeds a different VIN (related-car pollution).
  if (expectedVin) {
    usable = usable.filter((p) => {
      const m = p.sourceUrl.toUpperCase().match(/\/([A-HJ-NPR-Z0-9]{17})(?=[-/.]|$)/);
      return !m || m[1] === expectedVin;
    });
  }

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
