/**
 * Mirror listing photos from source_url into Cloudflare R2, then set stored_path.
 */
import { createHash } from "node:crypto";
import { and, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { db, pool, listingsTable, photosTable, providersTable } from "@workspace/db";
import { photoIdentityKey } from "./providers/web-html";
import { isR2Configured, loadR2Config, r2ObjectExists, r2PublicUrl, r2PutObject } from "./r2";
import { logger } from "./logger";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Catalog / temp hosts — after R2 mirror, replace source_url with the CDN URL. */
const SCRUB_SOURCE_AFTER_MIRROR_PROVIDERS = new Set([
  "kmcheck",
  "kmcheck_manual",
  "carstat",
]);

function isEphemeralMirrorSource(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return (
      host === "ibb.co" ||
      host.endsWith(".ibb.co") ||
      host === "imgbb.com" ||
      host.endsWith(".imgbb.com")
    );
  } catch {
    return /ibb\.co|imgbb\.com/i.test(url);
  }
}

function isCdnStoredUrl(url: string | null | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  return /imgsv\.getcarapi\.com|\.r2\.dev\//i.test(url);
}

export type MirrorPhotosOptions = {
  /** Limit how many unmirrored rows to process this run. */
  limit?: number;
  /** Parallel downloads/uploads. */
  concurrency?: number;
  /** Only rows whose source_url matches (e.g. "%import-motor.com%"). */
  hostLike?: string;
  /** Only this vehicle (used by on-crawl mirror). */
  vehicleId?: number;
  /** Restrict to listings owned by these provider internal_name values. */
  providerInternalNames?: string[];
  /** Prefer primary photos first. */
  primariesFirst?: boolean;
  dryRun?: boolean;
};

export type MirrorPhotosResult = {
  attempted: number;
  uploaded: number;
  reused: number;
  failed: number;
  skipped: number;
  errors: Array<{ photoId: number; url: string; error: string }>;
};

function extFromUrlOrType(url: string, contentType: string | null): string {
  const path = url.split("?")[0]!.toLowerCase();
  if (/\.webp$/i.test(path)) return ".webp";
  if (/\.png$/i.test(path)) return ".png";
  if (/\.gif$/i.test(path)) return ".gif";
  if (/\.jpe?g$/i.test(path)) return ".jpg";
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("gif")) return ".gif";
  return ".jpg";
}

export function r2ObjectKeyForSourceUrl(sourceUrl: string, contentType?: string | null): string {
  const identity = photoIdentityKey(sourceUrl);
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 40);
  const ext = extFromUrlOrType(sourceUrl, contentType ?? null);
  return `p/${hash}${ext}`;
}

/** Public CDN URL when mirrored; otherwise original source. */
export function photoServeUrl(photo: { sourceUrl: string; storedPath?: string | null }): string {
  const stored = photo.storedPath?.trim();
  if (!stored) return photo.sourceUrl;
  if (/^https?:\/\//i.test(stored)) return stored;
  const cfg = loadR2Config();
  if (!cfg) return photo.sourceUrl;
  return r2PublicUrl(stored);
}

async function downloadImage(url: string): Promise<{ body: Buffer; contentType: string }> {
  let referer = "https://import-motor.com/";
  try {
    const host = new URL(url).hostname;
    if (/encar\.com/i.test(host)) referer = "https://www.encar.com/";
    else if (/import-motor\.com/i.test(host)) referer = "https://import-motor.com/";
    else if (/copart\.com/i.test(host)) referer = "https://www.copart.com/";
    else if (/iaai\.com/i.test(host)) referer = "https://www.iaai.com/";
    else if (/autowini\.com/i.test(host)) referer = "https://www.autowini.com/";
    else if (/kbchachacha\.com/i.test(host)) referer = "https://www.kbchachacha.com/";
    else if (/kcar\.com/i.test(host)) referer = "https://www.kcar.com/";
    else if (/charancha\.com/i.test(host)) referer = "https://www.charancha.com/";
    else if (/autohub\.co\.kr/i.test(host)) referer = "https://www.autohub.co.kr/";
    else if (/lotte-autoglobal\.net/i.test(host)) referer = "https://www.lotte-autoglobal.net/";
    else if (/lotteautoauction\.net/i.test(host)) referer = "https://www.lotteautoauction.net/";
    else if (/heydealer\.com/i.test(host)) referer = "https://www.heydealer.com/";
    else if (/bobaedream\.co\.kr/i.test(host)) referer = "https://www.bobaedream.co.kr/";
    else if (/autobell/i.test(host)) referer = "https://www.autobell.co.kr/";
    else if (/carpoolkr\.com/i.test(host)) referer = "https://www.carpoolkr.com/";
    else referer = `https://${host}/`;
  } catch {
    /* keep default */
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          Referer: referer,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = (res.headers.get("content-type") || "application/octet-stream").split(";")[0]!.trim();
      if (!/^image\//i.test(contentType) && !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) {
        throw new Error(`Not an image content-type: ${contentType}`);
      }
      const ab = await res.arrayBuffer();
      if (ab.byteLength < 100) throw new Error(`Image too small (${ab.byteLength} bytes)`);
      if (ab.byteLength > 25 * 1024 * 1024) throw new Error(`Image too large (${ab.byteLength} bytes)`);
      return { body: Buffer.from(ab), contentType: contentType.startsWith("image/") ? contentType : "image/jpeg" };
    } catch (err) {
      lastErr = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

/**
 * Download unmirrored photos and upload to R2.
 * Rows that share the same photoIdentityKey reuse one object key.
 */
export async function mirrorPhotos(opts: MirrorPhotosOptions = {}): Promise<MirrorPhotosResult> {
  if (!isR2Configured()) {
    throw new Error("R2 is not configured — set R2_* env vars");
  }

  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 5_000);
  const concurrency = Math.min(Math.max(opts.concurrency ?? 6, 1), 20);
  const hostLike = opts.hostLike?.trim();

  const conditions = [isNull(photosTable.storedPath)];
  if (hostLike) conditions.push(ilike(photosTable.sourceUrl, hostLike));
  if (opts.vehicleId != null) conditions.push(eq(photosTable.vehicleId, opts.vehicleId));
  const providerNames = (opts.providerInternalNames ?? [])
    .map((n) => n.trim())
    .filter(Boolean);
  if (providerNames.length) {
    const listingIds = await db
      .select({ id: listingsTable.id })
      .from(listingsTable)
      .innerJoin(providersTable, eq(listingsTable.providerId, providersTable.id))
      .where(inArray(providersTable.internalName, providerNames));
    const ids = listingIds.map((r) => r.id);
    if (!ids.length) {
      return { attempted: 0, uploaded: 0, reused: 0, failed: 0, skipped: 0, errors: [] };
    }
    conditions.push(inArray(photosTable.listingId, ids));
  }

  const orderSql = opts.primariesFirst
    ? sql`${photosTable.isPrimary} DESC, ${photosTable.sortOrder} ASC, ${photosTable.id} ASC`
    : sql`${photosTable.sortOrder} ASC, ${photosTable.isPrimary} DESC, ${photosTable.id} ASC`;

  const rows = await db
    .select({
      id: photosTable.id,
      sourceUrl: photosTable.sourceUrl,
      vehicleId: photosTable.vehicleId,
      listingId: photosTable.listingId,
      providerInternalName: providersTable.internalName,
    })
    .from(photosTable)
    .leftJoin(listingsTable, eq(photosTable.listingId, listingsTable.id))
    .leftJoin(providersTable, eq(listingsTable.providerId, providersTable.id))
    .where(and(...conditions))
    .orderBy(orderSql)
    .limit(limit);

  const result: MirrorPhotosResult = {
    attempted: rows.length,
    uploaded: 0,
    reused: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  // identity → stored_path (public CDN URL) once resolved in this run
  const storedByIdentity = new Map<string, string>();

  await runPool(rows, concurrency, async (row) => {
    try {
      const identity = photoIdentityKey(row.sourceUrl);

      if (!storedByIdentity.has(identity)) {
        const [existing] = await db
          .select({ storedPath: photosTable.storedPath })
          .from(photosTable)
          .where(
            and(
              sql`${photosTable.storedPath} IS NOT NULL`,
              sql`${photosTable.storedPath} <> ''`,
              eq(photosTable.sourceUrl, row.sourceUrl),
            ),
          )
          .limit(1);
        if (existing?.storedPath) {
          storedByIdentity.set(identity, existing.storedPath);
        }
      }

      if (!storedByIdentity.has(identity) && !opts.dryRun) {
        const vinShot = row.sourceUrl.match(/([A-HJ-NPR-Z0-9]{17})-(\d+)\.(jpe?g|webp|png)/i);
        if (vinShot) {
          const siblings = await db
            .select({ storedPath: photosTable.storedPath, sourceUrl: photosTable.sourceUrl })
            .from(photosTable)
            .where(
              and(
                sql`${photosTable.storedPath} IS NOT NULL`,
                ilike(photosTable.sourceUrl, `%${vinShot[1]}-${vinShot[2]}.%`),
              ),
            )
            .limit(8);
          for (const sib of siblings) {
            if (sib.storedPath && photoIdentityKey(sib.sourceUrl) === identity) {
              storedByIdentity.set(identity, sib.storedPath);
              break;
            }
          }
        }
      }

      let stored = storedByIdentity.get(identity);
      if (!stored) {
        if (opts.dryRun) {
          result.skipped += 1;
          return;
        }
        const { body, contentType } = await downloadImage(row.sourceUrl);
        const objectKey = r2ObjectKeyForSourceUrl(row.sourceUrl, contentType);
        if (await r2ObjectExists(objectKey)) {
          stored = r2PublicUrl(objectKey);
          result.reused += 1;
        } else {
          const put = await r2PutObject({ key: objectKey, body, contentType });
          stored = put.publicUrl;
          result.uploaded += 1;
        }
        storedByIdentity.set(identity, stored);
      } else {
        result.reused += 1;
      }

      if (opts.dryRun) {
        result.skipped += 1;
        return;
      }

      const scrubSource =
        isCdnStoredUrl(stored) &&
        (isEphemeralMirrorSource(row.sourceUrl) ||
          SCRUB_SOURCE_AFTER_MIRROR_PROVIDERS.has(row.providerInternalName ?? ""));

      await db
        .update(photosTable)
        .set(
          scrubSource
            ? { storedPath: stored, sourceUrl: stored }
            : { storedPath: stored },
        )
        .where(eq(photosTable.id, row.id));
    } catch (err) {
      result.failed += 1;
      result.errors.push({
        photoId: row.id,
        url: row.sourceUrl.slice(0, 160),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return result;
}

/** Mirror every unmirrored photo for one vehicle (used right after crawl / catalog import). */
export async function mirrorPhotosForVehicle(
  vehicleId: number,
  opts: { concurrency?: number } = {},
): Promise<MirrorPhotosResult> {
  const total: MirrorPhotosResult = {
    attempted: 0,
    uploaded: 0,
    reused: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };
  const concurrency = opts.concurrency ?? 4;

  // Drain every unmirrored photo for this vehicle (gallery order, not primary-only).
  for (let round = 0; round < 50; round++) {
    const batch = await mirrorPhotos({
      vehicleId,
      limit: 80,
      concurrency,
      primariesFirst: false,
    });
    total.attempted += batch.attempted;
    total.uploaded += batch.uploaded;
    total.reused += batch.reused;
    total.failed += batch.failed;
    total.skipped += batch.skipped;
    if (batch.errors.length) {
      total.errors.push(...batch.errors);
      if (total.errors.length > 40) total.errors.length = 40;
    }
    if (batch.attempted === 0) break;
  }

  return total;
}

/** True when R2 credentials are set and auto-mirror is not explicitly disabled. */
export function isPhotoMirrorEnabled(): boolean {
  if (!isR2Configured()) return false;
  if (process.env.R2_MIRROR_ON_CRAWL === "0") return false;
  return true;
}

/** In-process queue so crawl / import stays fast while R2 uploads catch up. */
const mirrorQueue: number[] = [];
const queuedVehicleIds = new Set<number>();
let mirrorWorkers = 0;
const MAX_MIRROR_WORKERS = Math.min(
  12,
  Math.max(1, Number(process.env.R2_MIRROR_VEHICLE_CONCURRENCY ?? "6") || 6),
);

function pumpMirrorQueue(): void {
  while (mirrorWorkers < MAX_MIRROR_WORKERS && mirrorQueue.length > 0) {
    const vehicleId = mirrorQueue.shift()!;
    queuedVehicleIds.delete(vehicleId);
    mirrorWorkers += 1;
    mirrorPhotosForVehicle(vehicleId)
      .then((result) => {
        if (result.attempted > 0) {
          logger.info(
            {
              vehicleId,
              uploaded: result.uploaded,
              reused: result.reused,
              failed: result.failed,
            },
            "R2 photo mirror (on-ingest)",
          );
        }
      })
      .catch((err) => {
        logger.warn({ err, vehicleId }, "R2 photo mirror failed");
      })
      .finally(() => {
        mirrorWorkers -= 1;
        pumpMirrorQueue();
      });
  }
}

/**
 * Fire-and-forget: after a VIN's photos are saved, upload them to R2.
 * For kmcheck/carstat (and ibb.co hosts), source_url is rewritten to the CDN URL after success.
 */
export function scheduleVehiclePhotoMirror(vehicleId: number): void {
  if (!Number.isFinite(vehicleId) || vehicleId <= 0) return;
  if (!isPhotoMirrorEnabled()) return;
  if (queuedVehicleIds.has(vehicleId)) return;
  if (mirrorQueue.length >= 500) {
    // Drop oldest to avoid unbounded memory if R2/download is wedged.
    const dropped = mirrorQueue.shift();
    if (dropped != null) queuedVehicleIds.delete(dropped);
  }
  queuedVehicleIds.add(vehicleId);
  mirrorQueue.push(vehicleId);
  pumpMirrorQueue();
}

/**
 * Continuous background drain for unmirrored photos — same job as the offline
 * `mirror-photos` loop, but runs inside the API process once R2 is configured.
 */
let bgMirrorRunning = false;
let bgMirrorTimer: ReturnType<typeof setTimeout> | null = null;
let bgMirrorBusy = false;

/** One mirror batch at a time — background worker + backfill share this lock. */
let mirrorBatchLock = false;

const BG_BATCH_LIMIT = Math.min(
  500,
  Math.max(20, Number(process.env.R2_MIRROR_BATCH_LIMIT ?? "200") || 200),
);
const BG_BATCH_CONCURRENCY = Math.min(
  20,
  Math.max(1, Number(process.env.R2_MIRROR_BATCH_CONCURRENCY ?? "12") || 12),
);
const BG_IDLE_MS = Math.max(5_000, Number(process.env.R2_MIRROR_IDLE_MS ?? "45_000") || 45_000);
const BG_ACTIVE_MS = Math.max(2_000, Number(process.env.R2_MIRROR_ACTIVE_MS ?? "8_000") || 8_000);

const BACKFILL_BATCH_LIMIT = Math.min(
  5000,
  Math.max(50, Number(process.env.R2_MIRROR_BACKFILL_BATCH ?? "500") || 500),
);
const BACKFILL_CONCURRENCY = Math.min(
  24,
  Math.max(1, Number(process.env.R2_MIRROR_BACKFILL_CONCURRENCY ?? "16") || 16),
);
const BACKFILL_GAP_MS = Math.max(250, Number(process.env.R2_MIRROR_BACKFILL_GAP_MS ?? "1000") || 1000);

export type PhotoMirrorBackfillStatus = {
  running: boolean;
  startedAt: string | null;
  batches: number;
  attempted: number;
  uploaded: number;
  reused: number;
  failed: number;
  pending: number | null;
  lastBatchAt: string | null;
};

let backfillRunning = false;
let backfillStats: PhotoMirrorBackfillStatus = {
  running: false,
  startedAt: null,
  batches: 0,
  attempted: 0,
  uploaded: 0,
  reused: 0,
  failed: 0,
  pending: null,
  lastBatchAt: null,
};

function backfillEnabledOnBoot(): boolean {
  if (process.env.R2_MIRROR_BACKFILL_ON_BOOT === "0") return false;
  return true;
}

export async function countPendingMirrorPhotos(): Promise<number> {
  const { rows } = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM photos WHERE stored_path IS NULL`,
  );
  return Number(rows[0]?.c ?? 0);
}

/** Vehicles that still have unmirrored photos — finish partial galleries before brand-new cars. */
async function findVehiclesWithPendingPhotos(limit: number): Promise<number[]> {
  const cap = Math.min(Math.max(limit, 1), 100);
  const { rows } = await pool.query<{ vehicle_id: number }>(
    `SELECT p.vehicle_id
     FROM photos p
     GROUP BY p.vehicle_id
     HAVING count(*) FILTER (WHERE p.stored_path IS NULL) > 0
     ORDER BY
       (count(*) FILTER (WHERE p.stored_path ~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/') > 0) ASC,
       max(p.created_at) DESC,
       count(*) FILTER (WHERE p.stored_path IS NULL) DESC,
       max(CASE WHEN p.is_primary THEN 0 ELSE 1 END),
       p.vehicle_id
     LIMIT $1`,
    [cap],
  );
  return rows.map((r) => Number(r.vehicle_id)).filter((id) => Number.isFinite(id) && id > 0);
}

function mergeMirrorResults(parts: MirrorPhotosResult[]): MirrorPhotosResult {
  const total: MirrorPhotosResult = {
    attempted: 0,
    uploaded: 0,
    reused: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };
  for (const part of parts) {
    total.attempted += part.attempted;
    total.uploaded += part.uploaded;
    total.reused += part.reused;
    total.failed += part.failed;
    total.skipped += part.skipped;
    if (part.errors.length) {
      total.errors.push(...part.errors);
      if (total.errors.length > 40) total.errors.length = 40;
    }
  }
  return total;
}

const VEHICLE_MIRROR_BATCH = Math.min(
  40,
  Math.max(1, Number(process.env.R2_MIRROR_VEHICLES_PER_BATCH ?? "12") || 12),
);
const VEHICLE_MIRROR_PARALLEL = Math.min(
  8,
  Math.max(1, Number(process.env.R2_MIRROR_VEHICLE_PARALLEL ?? "4") || 4),
);

/**
 * Mirror all pending photos for a batch of vehicles (complete each car before moving on).
 * Never uses the old global primary-first scatter that left 1 CDN image per car.
 */
export async function mirrorNextBatch(opts: {
  vehicleLimit?: number;
  concurrency?: number;
} = {}): Promise<MirrorPhotosResult> {
  const vehicleLimit = opts.vehicleLimit ?? VEHICLE_MIRROR_BATCH;
  const perVehicleConcurrency = Math.min(
    opts.concurrency ?? BG_BATCH_CONCURRENCY,
    10,
  );

  const ids = await findVehiclesWithPendingPhotos(vehicleLimit);
  if (!ids.length) {
    return { attempted: 0, uploaded: 0, reused: 0, failed: 0, skipped: 0, errors: [] };
  }

  const parts: MirrorPhotosResult[] = [];
  for (let i = 0; i < ids.length; i += VEHICLE_MIRROR_PARALLEL) {
    const chunk = ids.slice(i, i + VEHICLE_MIRROR_PARALLEL);
    const chunkResults = await Promise.all(
      chunk.map((vehicleId) =>
        mirrorPhotosForVehicle(vehicleId, { concurrency: perVehicleConcurrency }),
      ),
    );
    parts.push(...chunkResults);
  }
  return mergeMirrorResults(parts);
}

export function getPhotoMirrorBackfillStatus(): PhotoMirrorBackfillStatus {
  return { ...backfillStats, running: backfillRunning };
}

async function runLockedMirrorBatch(
  opts: MirrorPhotosOptions & { vehicleLimit?: number },
): Promise<MirrorPhotosResult | null> {
  if (mirrorBatchLock) return null;
  mirrorBatchLock = true;
  try {
    if (opts.vehicleId != null) {
      return await mirrorPhotos(opts);
    }
    return await mirrorNextBatch({
      vehicleLimit: opts.vehicleLimit,
      concurrency: opts.concurrency,
    });
  } finally {
    mirrorBatchLock = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Drain unmirrored photos (all ages) until idle or stopped. Idempotent. */
export function startPhotoMirrorBackfill(): boolean {
  if (!isPhotoMirrorEnabled()) return false;
  if (backfillRunning) return true;
  backfillRunning = true;
  backfillStats = {
    running: true,
    startedAt: new Date().toISOString(),
    batches: 0,
    attempted: 0,
    uploaded: 0,
    reused: 0,
    failed: 0,
    pending: null,
    lastBatchAt: null,
  };
  logger.info(
    { batchLimit: BACKFILL_BATCH_LIMIT, concurrency: BACKFILL_CONCURRENCY },
    "R2 photo mirror backfill started — uploading old crawl photos to CDN",
  );
  void runPhotoMirrorBackfillLoop();
  return true;
}

export function stopPhotoMirrorBackfill(): void {
  if (!backfillRunning) return;
  backfillRunning = false;
  backfillStats.running = false;
  logger.info(backfillStats, "R2 photo mirror backfill stopped");
}

async function runPhotoMirrorBackfillLoop(): Promise<void> {
  try {
    for (;;) {
      if (!backfillRunning || !isPhotoMirrorEnabled()) break;

      const result = await runLockedMirrorBatch({
        vehicleLimit: VEHICLE_MIRROR_BATCH,
        concurrency: BACKFILL_CONCURRENCY,
      });

      if (result === null) {
        await sleep(Math.max(BACKFILL_GAP_MS, 1500));
        continue;
      }

      if (result.attempted === 0) {
        backfillStats.pending = await countPendingMirrorPhotos().catch(() => null);
        if ((backfillStats.pending ?? 0) > 0) {
          await sleep(BACKFILL_GAP_MS);
          continue;
        }
        logger.info(backfillStats, "R2 photo mirror backfill complete — no pending rows");
        break;
      }

      backfillStats.batches += 1;
      backfillStats.attempted += result.attempted;
      backfillStats.uploaded += result.uploaded;
      backfillStats.reused += result.reused;
      backfillStats.failed += result.failed;
      backfillStats.lastBatchAt = new Date().toISOString();

      if (backfillStats.batches === 1 || backfillStats.batches % 10 === 0) {
        backfillStats.pending = await countPendingMirrorPhotos().catch(() => null);
        logger.info(backfillStats, "R2 photo mirror backfill progress");
      }

      await sleep(BACKFILL_GAP_MS);
    }
  } catch (err) {
    logger.warn({ err }, "R2 photo mirror backfill loop error");
  } finally {
    backfillRunning = false;
    backfillStats.running = false;
    try {
      backfillStats.pending = await countPendingMirrorPhotos();
    } catch {
      /* ignore */
    }
  }
}

function scheduleBackgroundMirror(delayMs: number): void {
  if (!bgMirrorRunning) return;
  bgMirrorTimer = setTimeout(() => {
    void runBackgroundMirrorBatch();
  }, delayMs);
}

async function runBackgroundMirrorBatch(): Promise<void> {
  if (!bgMirrorRunning || bgMirrorBusy) return;
  if (!isPhotoMirrorEnabled()) {
    scheduleBackgroundMirror(BG_IDLE_MS);
    return;
  }

  bgMirrorBusy = true;
  let nextDelay = BG_IDLE_MS;
  try {
    const result = await runLockedMirrorBatch({
      vehicleLimit: VEHICLE_MIRROR_BATCH,
      concurrency: BG_BATCH_CONCURRENCY,
    });
    if (result && result.attempted > 0) {
      nextDelay = BG_ACTIVE_MS;
      logger.info(
        {
          attempted: result.attempted,
          uploaded: result.uploaded,
          reused: result.reused,
          failed: result.failed,
        },
        "R2 photo mirror (background)",
      );
    }
  } catch (err) {
    logger.warn({ err }, "R2 background mirror batch failed");
    nextDelay = BG_IDLE_MS;
  } finally {
    bgMirrorBusy = false;
    scheduleBackgroundMirror(nextDelay);
  }
}

/** Start the always-on R2 drain worker (idempotent). */
export function startPhotoMirrorBackgroundWorker(): void {
  if (bgMirrorRunning) return;
  if (!isPhotoMirrorEnabled()) {
    logger.info("R2 photo mirror disabled (set R2_* and R2_MIRROR_ON_CRAWL≠0 to enable)");
    return;
  }
  bgMirrorRunning = true;
  const cfg = loadR2Config();
  logger.info(
    {
      cdn: cfg?.publicBaseUrl,
      batchLimit: VEHICLE_MIRROR_BATCH,
      vehicleParallel: VEHICLE_MIRROR_PARALLEL,
      vehicleConcurrency: MAX_MIRROR_WORKERS,
      batchConcurrency: BG_BATCH_CONCURRENCY,
    },
    "R2 photo mirror background worker started — new VIN photos auto-upload to Cloudflare",
  );
  scheduleBackgroundMirror(2_000);

  if (backfillEnabledOnBoot()) {
    void countPendingMirrorPhotos()
      .then((pending) => {
        if (pending > 0) {
          logger.info({ pending }, "Starting R2 backfill for existing unmirrored photos");
          startPhotoMirrorBackfill();
        }
      })
      .catch((err) => {
        logger.warn({ err }, "Could not count pending photos for backfill");
        startPhotoMirrorBackfill();
      });
  }
}

export function stopPhotoMirrorBackgroundWorker(): void {
  bgMirrorRunning = false;
  if (bgMirrorTimer) {
    clearTimeout(bgMirrorTimer);
    bgMirrorTimer = null;
  }
}
