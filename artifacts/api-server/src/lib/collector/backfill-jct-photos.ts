/**
 * Re-fetch JapaneseCarTrade detail pages and restore the below-hero album
 * (vimg.gabs.biz / mycarguru.ai via #other_images_* / ___ShowOtherImages).
 * Thin 1-photo rows only have the CDN primary — never related-car sim_image thumbs.
 *
 * Run: pnpm backfill:jct-photos [--dry-run] [--limit N] [--delay MS] [--min-photos N]
 *   [--vin VIN] [--listing-id ID] [--since-days N]
 */
import { eq, sql } from "drizzle-orm";
import { db, photosTable } from "@workspace/db";
import { storePhotos } from "./pipeline";
import { isJunkPhotoUrl } from "../providers/web-html";
import {
  JapanesecartradeHistoricalAdapter,
  japanesecartradeDetailUrl,
} from "../providers/japanesecartrade";
import { logger } from "../logger";

export interface JctPhotoBackfillOptions {
  dryRun?: boolean;
  limit?: number;
  delayMs?: number;
  listingId?: number;
  vin?: string;
  /** Re-fetch when gallery count is below N (default 2 — catches 1-photo heroes). */
  minPhotos?: number;
  /** Only listings last seen within N days (default 0 = all). */
  sinceDays?: number;
}

export interface JctPhotoBackfillStats {
  scannedListings: number;
  fetched: number;
  repaired: number;
  photosAdded: number;
  errors: number;
  skipped: number;
  dryRun: boolean;
}

type AffectedListing = {
  listingId: number;
  vehicleId: number;
  sourceId: string;
  sourceUrl: string | null;
  vin: string | null;
  photoCount: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseJctBackfillArgs(argv: string[]): JctPhotoBackfillOptions {
  const opts: JctPhotoBackfillOptions = {
    dryRun: false,
    limit: 200,
    delayMs: 1200,
    minPhotos: 2,
    sinceDays: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--limit" && argv[i + 1]) opts.limit = Math.max(1, Number(argv[++i]) || 200);
    else if (arg === "--delay" && argv[i + 1]) opts.delayMs = Math.max(0, Number(argv[++i]) || 1200);
    else if (arg === "--min-photos" && argv[i + 1]) opts.minPhotos = Math.max(1, Number(argv[++i]) || 2);
    else if (arg === "--since-days" && argv[i + 1]) opts.sinceDays = Math.max(0, Number(argv[++i]) || 0);
    else if (arg === "--listing-id" && argv[i + 1]) opts.listingId = Number(argv[++i]) || undefined;
    else if (arg === "--vin" && argv[i + 1]) opts.vin = String(argv[++i]).trim().toUpperCase() || undefined;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: pnpm backfill:jct-photos [options]

  --dry-run           List thin JCT galleries only
  --limit N           Max listings to repair (default 200)
  --delay MS          Pause between fetches (default 1200) — needs CDP
  --min-photos N      Repair when count < N (default 2)
  --since-days N      Only listings last seen within N days (0 = all)
  --listing-id ID     Repair one listing
  --vin VIN           Repair one VIN
`);
      process.exit(0);
    }
  }
  return opts;
}

async function findAffectedListings(opts: JctPhotoBackfillOptions): Promise<AffectedListing[]> {
  const minPhotos = opts.minPhotos ?? 2;
  const limit = opts.limit ?? 200;

  const filters = [sql`pr.internal_name = 'japanesecartrade'`, sql`l.vehicle_id IS NOT NULL`];
  if (opts.listingId != null) filters.push(sql`l.id = ${opts.listingId}`);
  if (opts.vin) filters.push(sql`v.vin = ${opts.vin}`);
  if ((opts.sinceDays ?? 0) > 0 && opts.vin == null && opts.listingId == null) {
    const since = new Date(Date.now() - opts.sinceDays! * 86_400_000);
    filters.push(sql`l.last_seen_at >= ${since}`);
  }

  const having =
    opts.vin != null || opts.listingId != null
      ? sql`TRUE`
      : sql`count(p.id) < ${minPhotos}`;

  const rows = await db.execute(sql`
    SELECT
      l.id AS listing_id,
      l.vehicle_id AS vehicle_id,
      l.source_id AS source_id,
      l.source_url AS source_url,
      v.vin AS vin,
      count(p.id)::int AS photo_count
    FROM listings l
    JOIN providers pr ON pr.id = l.provider_id
    JOIN vehicles v ON v.id = l.vehicle_id
    LEFT JOIN photos p ON p.vehicle_id = v.id
    WHERE ${sql.join(filters, sql` AND `)}
    GROUP BY l.id, l.vehicle_id, l.source_id, l.source_url, v.vin
    HAVING ${having}
    ORDER BY l.last_seen_at DESC NULLS LAST, l.id DESC
    LIMIT ${limit}
  `);

  const listingRows = Array.isArray(rows)
    ? (rows as Array<Record<string, unknown>>)
    : ((rows as { rows?: Array<Record<string, unknown>> }).rows ?? []);

  return listingRows.map((r) => ({
    listingId: Number(r.listing_id),
    vehicleId: Number(r.vehicle_id),
    sourceId: String(r.source_id ?? ""),
    sourceUrl: r.source_url != null ? String(r.source_url) : null,
    vin: r.vin != null ? String(r.vin) : null,
    photoCount: Number(r.photo_count ?? 0),
  }));
}

function detailUrlFor(listing: AffectedListing): string {
  const fromRow = listing.sourceUrl?.trim();
  if (fromRow && /^https?:\/\//i.test(fromRow)) return japanesecartradeDetailUrl(fromRow);
  if (/^\d+$/.test(listing.sourceId)) return japanesecartradeDetailUrl(listing.sourceId);
  return japanesecartradeDetailUrl(listing.sourceId);
}

async function repairListing(
  listing: AffectedListing,
  adapter: JapanesecartradeHistoricalAdapter,
): Promise<{ added: number; parsedCount: number; error?: string }> {
  const detailUrl = detailUrlFor(listing);
  const before = await db
    .select({ id: photosTable.id })
    .from(photosTable)
    .where(eq(photosTable.vehicleId, listing.vehicleId));
  const beforeIds = new Set(before.map((p) => p.id));

  const fetched = await adapter.fetchListing(detailUrl);
  const parsed = await adapter.parseListing(fetched);
  const usable = (parsed.photos ?? []).filter((p) => p?.sourceUrl && !isJunkPhotoUrl(p.sourceUrl));

  // Album AJAX is authoritative; keep any non-related image. Detail-only heroes still pass via CDN.
  const cleaned = usable.filter((p) => {
    const u = p.sourceUrl;
    if (/\/jct\/thumbnail\//i.test(u)) return false;
    if (/sim_image/i.test(u)) return false;
    if (/logo|sprite|favicon|placeholder|nophoto/i.test(u)) return false;
    return /\.(?:jpe?g|webp|png)(?:$|\?)|\/vehicle_image\//i.test(u);
  });

  if (cleaned.length === 0) {
    return { added: 0, parsedCount: 0, error: "no_photos_parsed" };
  }
  const richer = cleaned.length > listing.photoCount;
  if (!richer) {
    return { added: 0, parsedCount: cleaned.length, error: "no_richer_gallery" };
  }

  await storePhotos(listing.vehicleId, listing.listingId, cleaned);

  const after = await db
    .select({ id: photosTable.id })
    .from(photosTable)
    .where(eq(photosTable.vehicleId, listing.vehicleId));
  const added = after.filter((row) => !beforeIds.has(row.id)).length;

  void import("../photo-mirror")
    .then(({ scheduleVehiclePhotoMirror }) => scheduleVehiclePhotoMirror(listing.vehicleId))
    .catch(() => undefined);

  return { added, parsedCount: cleaned.length };
}

let backfillAbort = false;
export function abortJctPhotoBackfill(): void {
  backfillAbort = true;
}

export async function backfillJctPhotos(
  options: JctPhotoBackfillOptions = {},
): Promise<JctPhotoBackfillStats> {
  backfillAbort = false;
  const dryRun = Boolean(options.dryRun);
  const delayMs = options.delayMs ?? 1200;
  const adapter = new JapanesecartradeHistoricalAdapter();

  if (!process.env.JCT_CDP_URL && !process.env.IMPORT_MOTOR_CDP_URL && !process.env.AUTOPLAC_CDP_URL) {
    console.warn(
      "Warning: no JCT_CDP_URL / IMPORT_MOTOR_CDP_URL set — gallery AJAX is CF-blocked without Chrome CDP",
    );
  }

  const affected = await findAffectedListings(options);
  const stats: JctPhotoBackfillStats = {
    scannedListings: affected.length,
    fetched: 0,
    repaired: 0,
    photosAdded: 0,
    errors: 0,
    skipped: 0,
    dryRun,
  };

  for (let i = 0; i < affected.length; i++) {
    if (backfillAbort) {
      console.warn("JCT photo backfill aborted");
      break;
    }
    const listing = affected[i]!;
    const label = listing.vin ?? listing.sourceId;
    console.log(
      `[${i + 1}/${affected.length}] ${label} listing=${listing.listingId} photos=${listing.photoCount} → ${detailUrlFor(listing)}`,
    );

    if (dryRun) {
      stats.skipped++;
      continue;
    }

    try {
      stats.fetched++;
      const result = await repairListing(listing, adapter);
      if (result.error === "no_richer_gallery") {
        stats.skipped++;
        console.log(`  skip: parsed ${result.parsedCount} (not richer)`);
      } else if (result.error) {
        stats.errors++;
        console.log(`  error: ${result.error}`);
      } else {
        stats.repaired++;
        stats.photosAdded += result.added;
        console.log(`  ok: parsed=${result.parsedCount} added=${result.added}`);
      }
    } catch (err) {
      stats.errors++;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  fail: ${message}`);
      logger.warn({ err, listingId: listing.listingId, vin: listing.vin }, "JCT photo backfill failed");
    }

    if (delayMs > 0 && i + 1 < affected.length) await sleep(delayMs);
  }

  return stats;
}
