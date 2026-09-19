/**
 * Mirror listing photos from source_url into Cloudflare R2, then set stored_path.
 */
import { createHash } from "node:crypto";
import { and, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { db, pool, listingsTable, photosTable, providersTable } from "@workspace/db";
import { photoIdentityKey } from "./providers/web-html";
import { shouldMirrorPhotoUrl, isEphemeralPhotoHost, isMirrorFailedPath } from "./photo-response";
import { isR2Configured, loadR2Config, r2ObjectExists, r2PublicUrl, r2PutObject } from "./r2";
import { logger } from "./logger";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Catalog / temp hosts — after R2 mirror, replace source_url with the CDN URL. */
const SCRUB_SOURCE_AFTER_MIRROR_PROVIDERS = new Set([
  "kmcheck",
  "kmcheck_manual",
  "carstat",
  "ontariocars",
  "carpages",
]);

function isEphemeralMirrorSource(url: string): boolean {
  return isEphemeralPhotoHost(url);
}

function isCdnStoredUrl(url: string | null | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  return /imgsv\.getcarapi\.com|\.r2\.dev\//i.test(url);
}

function jctCdpEndpoint(): string | undefined {
  return (
    process.env.JCT_CDP_URL?.trim() ||
    process.env.IMPORT_MOTOR_CDP_URL?.trim() ||
    process.env.AUTOPLAC_CDP_URL?.trim() ||
    process.env.CDP_URL?.trim() ||
    undefined
  );
}

function isJapaneseCarTradePhotoUrl(url: string): boolean {
  try {
    return /japanesecartrade\.com/i.test(new URL(url).hostname);
  } catch {
    return /japanesecartrade\.com/i.test(url);
  }
}

/** Cloudflare blocks Node fetch to JCT CDN; reuse the crawl Chrome session. */
async function downloadImageViaCdp(url: string): Promise<{ body: Buffer; contentType: string }> {
  const endpoint = jctCdpEndpoint();
  if (!endpoint) {
    throw new Error(
      "JapaneseCarTrade CDN requires Chrome CDP (set JCT_CDP_URL or IMPORT_MOTOR_CDP_URL=http://127.0.0.1:9222)",
    );
  }
  const base = endpoint.replace(/\/$/, "");
  const page = (await (
    await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })
  ).json()) as { id?: string; webSocketDebuggerUrl?: string };
  if (!page.webSocketDebuggerUrl || !page.id) {
    throw new Error("JapaneseCarTrade CDP could not open a tab for image download");
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("JCT CDP websocket connect timed out")), 15_000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("JCT CDP websocket failed"));
      });
    });

    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (msg.id == null) return;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"));
      else p.resolve(msg.result);
    });

    const send = <T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 45_000): Promise<T> =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, {
          resolve: (v) => resolve(v as T),
          reject,
        });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`JCT CDP timeout: ${method}`));
          }
        }, timeoutMs);
      });

    await send("Runtime.enable");
    // Give CF/session a moment if the tab landed on a challenge interstitial.
    await new Promise((r) => setTimeout(r, 1200));
    const evaluated = await send<{
      result?: {
        value?: { status?: number; ct?: string | null; b64?: string; len?: number; error?: string };
        subtype?: string;
        description?: string;
      };
    }>("Runtime.evaluate", {
      expression: `(async()=>{
        try {
          const r = await fetch(${JSON.stringify(url)}, { credentials: "include" });
          const buf = await r.arrayBuffer();
          const u8 = new Uint8Array(buf);
          let s = "";
          const chunk = 0x8000;
          for (let i = 0; i < u8.length; i += chunk) {
            s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunk)));
          }
          return { status: r.status, ct: r.headers.get("content-type"), len: u8.length, b64: btoa(s) };
        } catch (e) {
          return { error: String(e && e.message ? e.message : e) };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });

    const value = evaluated?.result?.value;
    if (!value || value.error) {
      throw new Error(value?.error || evaluated?.result?.description || "JCT CDP fetch failed");
    }
    if (value.status && value.status >= 400) {
      throw new Error(`HTTP ${value.status}`);
    }
    if (!value.b64 || !value.len || value.len < 100) {
      throw new Error(`JCT CDP image too small (${value.len ?? 0} bytes)`);
    }
    const body = Buffer.from(value.b64, "base64");
    const contentType = (value.ct || "image/jpeg").split(";")[0]!.trim();
    return {
      body,
      contentType: contentType.startsWith("image/") ? contentType : "image/jpeg",
    };
  } finally {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    await fetch(`${base}/json/close/${page.id}`).catch(() => undefined);
  }
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
  /**
   * Only photos on Import Motor–sourced listings (source_id im-% or import-motor.com/v/…).
   * Auction CDN frames (Copart/IAAI) are never mirrored — they stay as source links.
   */
  imSourced?: boolean;
  /** Prefer primary photos first. */
  primariesFirst?: boolean;
  /**
   * Cap how many photos to mirror per vehicle this run (cost control).
   * Omit to use env R2_MIRROR_MAX_PER_VEHICLE (default 1). Pass 0 for full gallery.
   */
  maxPerVehicle?: number;
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

/** Public CDN URL when mirrored; otherwise original source (never mirror-failed / ephemeral). */
export function photoServeUrl(photo: { sourceUrl: string; storedPath?: string | null }): string {
  const stored = photo.storedPath?.trim();
  if (stored && !isMirrorFailedPath(stored)) {
    if (/^https?:\/\//i.test(stored)) return stored;
    const cfg = loadR2Config();
    if (cfg) return r2PublicUrl(stored);
  }
  if (isMirrorFailedPath(stored) || isEphemeralPhotoHost(photo.sourceUrl)) {
    return "";
  }
  return rewriteSeznamSdnUrl(photo.sourceUrl);
}

/** Seznam SDN blocks raw object URLs (401); `fl=exf` is the minimal working transform. */
function rewriteSeznamSdnUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!/\.sdn\.cz$/i.test(u.hostname) && u.hostname.toLowerCase() !== "sdn.cz") return url;
    if (!u.searchParams.has("fl")) u.searchParams.set("fl", "exf");
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * BidDrive catalog often 404s on .jpg while .avif/.webp exist for the same frame.
 */
async function downloadImageWithBidriveFallbacks(
  url: string,
): Promise<{ body: Buffer; contentType: string; sourceUrl: string }> {
  const candidates = [url];
  try {
    const u = new URL(url);
    if (/cdn\.thebidrive\.com$/i.test(u.hostname) && /\.(jpe?g)$/i.test(u.pathname)) {
      candidates.push(url.replace(/\.(jpe?g)(\?|$)/i, ".avif$2"));
      candidates.push(url.replace(/\.(jpe?g)(\?|$)/i, ".webp$2"));
    }
  } catch {
    /* keep primary only */
  }
  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      const got = await downloadImage(candidate);
      return { ...got, sourceUrl: candidate };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function downloadImage(url: string): Promise<{ body: Buffer; contentType: string }> {
  url = rewriteSeznamSdnUrl(url);
  if (isJapaneseCarTradePhotoUrl(url)) {
    return downloadImageViaCdp(url);
  }
  let referer = "https://import-motor.com/";
  try {
    const host = new URL(url).hostname;
    if (/encar\.com/i.test(host)) referer = "https://www.encar.com/";
    else if (/import-motor\.com/i.test(host)) referer = "https://import-motor.com/";
    else if (/copart\.com/i.test(host)) referer = "https://www.copart.com/";
    else if (/iaai\.com/i.test(host)) referer = "https://www.iaai.com/";
    else if (/autowini\.com/i.test(host)) referer = "https://www.autowini.com/";
    else if (/thebidrive\.com/i.test(host)) referer = "https://thebidrive.com/";
    else if (/carpages\.ca/i.test(host)) referer = "https://www.carpages.ca/";
    else if (/ontariocars\.ca/i.test(host)) referer = "https://www.ontariocars.ca/";
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
    else if (/japanesecartrade\.com/i.test(host)) referer = "https://www.japanesecartrade.com/";
    else if (/mycarguru\.ai|gabs\.biz/i.test(host)) referer = "https://www.japanesecartrade.com/";
    else if (/\.sdn\.cz$/i.test(host) || host.toLowerCase() === "sdn.cz") referer = "https://www.sauto.cz/";
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

  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  const concurrency = Math.min(Math.max(opts.concurrency ?? 2, 1), 4);
  const hostLike = opts.hostLike?.trim();
  const maxPerVehicle =
    opts.maxPerVehicle != null ? opts.maxPerVehicle : mirrorMaxPerVehicle();

  const conditions = [
    isNull(photosTable.storedPath),
    // Copart / IAAI auction CDNs stay as source links — never upload to R2.
    sql`NOT (
      ${photosTable.sourceUrl} ILIKE '%copart.com%'
      OR ${photosTable.sourceUrl} ILIKE '%iaai.com%'
    )`,
  ];
  if (hostLike) conditions.push(ilike(photosTable.sourceUrl, hostLike));
  if (opts.vehicleId != null) conditions.push(eq(photosTable.vehicleId, opts.vehicleId));
  // When capping per vehicle, skip cars that already have enough CDN photos.
  if (maxPerVehicle > 0) {
    conditions.push(
      sql`(
        SELECT count(*)::int FROM photos px
        WHERE px.vehicle_id = ${photosTable.vehicleId}
          AND px.stored_path IS NOT NULL
          AND btrim(px.stored_path) <> ''
          AND px.stored_path NOT LIKE 'mirror-failed:%'
      ) < ${maxPerVehicle}`,
    );
  }
  if (opts.imSourced) {
    conditions.push(
      sql`exists (
        select 1 from listings lx
        where lx.id = ${photosTable.listingId}
          and (
            lx.source_id like 'im-%'
            or lx.source_url ilike '%import-motor.com/v/%'
          )
      )`,
    );
  }
  const providerNames = (opts.providerInternalNames ?? [])
    .map((n) => n.trim())
    .filter(Boolean);
  if (providerNames.length) {
    // Join filter — do NOT expand all listing ids into IN (...) (Import Motor is 100k+).
    conditions.push(
      sql`exists (
        select 1 from listings lx
        inner join providers px on px.id = lx.provider_id
        where lx.id = ${photosTable.listingId}
          and px.internal_name in (${sql.join(
            providerNames.map((n) => sql`${n}`),
            sql`, `,
          )})
      )`,
    );
  }

  // Prefer primary when capping per vehicle (thumbs first). Full-gallery mode keeps listing order.
  const primariesFirst = opts.primariesFirst ?? maxPerVehicle > 0;
  const orderSql = primariesFirst
      ? sql`${photosTable.isPrimary} DESC NULLS LAST, ${photosTable.sortOrder} ASC, ${photosTable.id} ASC`
      : sql`${photosTable.listingId} DESC NULLS LAST, ${photosTable.sortOrder} ASC, ${photosTable.isPrimary} DESC, ${photosTable.id} DESC`;

  let rows = await db
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

  if (maxPerVehicle > 0) {
    const seen = new Map<number, number>();
    rows = rows.filter((row) => {
      const vid = Number(row.vehicleId) || 0;
      if (!vid) return true;
      const n = seen.get(vid) ?? 0;
      if (n >= maxPerVehicle) return false;
      seen.set(vid, n + 1);
      return true;
    });
  }

  const result: MirrorPhotosResult = {
    attempted: rows.length,
    uploaded: 0,
    reused: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  // identity → stored_path (public CDN URL) once resolved in this run.
  // Reuse across vehicles via R2 object keys — do NOT scan photos by source_url
  // (no usable index; full-table scans starve the DB pool / admin UI).
  const storedByIdentity = new Map<string, string>();

  await runPool(rows, concurrency, async (row) => {
    try {
      if (!shouldMirrorPhotoUrl(row.sourceUrl)) {
        result.skipped += 1;
        return;
      }

      const identity = photoIdentityKey(row.sourceUrl);

      let stored = storedByIdentity.get(identity);
      if (!stored) {
        if (opts.dryRun) {
          result.skipped += 1;
          return;
        }
        const { body, contentType, sourceUrl: fetchedFrom } = await downloadImageWithBidriveFallbacks(
          row.sourceUrl,
        );
        const objectKey = r2ObjectKeyForSourceUrl(fetchedFrom || row.sourceUrl, contentType);
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
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({
        photoId: row.id,
        url: row.sourceUrl.slice(0, 160),
        error: message,
      });
      // Permanent poison only for gone lots. Transient 403 on Copart/IM cars CDN often
      // recovers on the next pass — do not park those forever as mirror-failed.
      const permanent =
        /HTTP (404|410|451)\b/i.test(message) ||
        (/HTTP (500|502|503)\b/i.test(message) && /vis\.iaai\.com/i.test(row.sourceUrl)) ||
        (/HTTP 403\b/i.test(message) &&
          !/cars2?\.import-motor\.com|cs\.copart\.com|ci\.encar\.com|japanesecartrade\.com|mycarguru\.ai|gabs\.biz/i.test(
            row.sourceUrl,
          ));
      if (permanent) {
        try {
          await db
            .update(photosTable)
            .set({ storedPath: `mirror-failed:${row.id}` })
            .where(and(eq(photosTable.id, row.id), isNull(photosTable.storedPath)));
        } catch {
          /* keep pending; next pass retries */
        }
      }
    }
  });

  return result;
}

/** Mirror every unmirrored photo for one vehicle (used right after crawl / catalog import). */
export async function mirrorPhotosForVehicle(
  vehicleId: number,
  opts: { concurrency?: number } = {},
): Promise<MirrorPhotosResult> {
  const maxPer = mirrorMaxPerVehicle();
  // Cost mode: one (or few) CDN thumbs per car — rest stay as provider photosOld links.
  if (maxPer > 0) {
    return mirrorPhotos({
      vehicleId,
      limit: maxPer,
      concurrency: opts.concurrency ?? 2,
      primariesFirst: true,
      maxPerVehicle: maxPer,
    });
  }

  const total: MirrorPhotosResult = {
    attempted: 0,
    uploaded: 0,
    reused: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };
  const concurrency = opts.concurrency ?? 2;

  for (let round = 0; round < 50; round++) {
    const batch = await mirrorPhotos({
      vehicleId,
      limit: 40,
      concurrency,
      primariesFirst: false,
      maxPerVehicle: 0,
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

/** Cost control: how many photos per car to put on CDN (1 = thumb only). 0 = full gallery. */
export function mirrorMaxPerVehicle(): number {
  const raw = Number(process.env.R2_MIRROR_MAX_PER_VEHICLE ?? "1");
  if (!Number.isFinite(raw) || raw < 0) return 1;
  return Math.min(Math.floor(raw), 40);
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
  4,
  Math.max(1, Number(process.env.R2_MIRROR_VEHICLE_CONCURRENCY ?? "2") || 2),
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
  200,
  Math.max(10, Number(process.env.R2_MIRROR_BATCH_LIMIT ?? "40") || 40),
);
const BG_BATCH_CONCURRENCY = Math.min(
  6,
  Math.max(1, Number(process.env.R2_MIRROR_BATCH_CONCURRENCY ?? "2") || 2),
);
const BG_IDLE_MS = Math.max(15_000, Number(process.env.R2_MIRROR_IDLE_MS ?? "90_000") || 90_000);
const BG_ACTIVE_MS = Math.max(8_000, Number(process.env.R2_MIRROR_ACTIVE_MS ?? "30_000") || 30_000);

const BACKFILL_BATCH_LIMIT = Math.min(
  500,
  Math.max(20, Number(process.env.R2_MIRROR_BACKFILL_BATCH ?? "80") || 80),
);
const BACKFILL_CONCURRENCY = Math.min(
  6,
  Math.max(1, Number(process.env.R2_MIRROR_BACKFILL_CONCURRENCY ?? "2") || 2),
);
const BACKFILL_GAP_MS = Math.max(2_000, Number(process.env.R2_MIRROR_BACKFILL_GAP_MS ?? "8000") || 8000);

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
  // Cost control: historical backfill is opt-in. New crawl mirrors still run via background worker.
  if (process.env.R2_MIRROR_BACKFILL_ON_BOOT === "1") return true;
  return false;
}

export async function countPendingMirrorPhotos(): Promise<number> {
  const { rows } = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM photos
     WHERE stored_path IS NULL
       AND source_url NOT ILIKE '%copart.com%'
       AND source_url NOT ILIKE '%iaai.com%'`,
  );
  return Number(rows[0]?.c ?? 0);
}

/** Vehicles that still need CDN photos — newest zero-CDN cars first (current inventory). */
async function findVehiclesWithPendingPhotos(limit: number): Promise<number[]> {
  const cap = Math.min(Math.max(limit, 1), 100);
  const maxPer = mirrorMaxPerVehicle();
  // Copart/IAAI auction CDNs are never mirrored — leave them as source links.
  // When maxPer > 0, only cars that still have fewer than maxPer CDN photos.
  // Priority: zero-CDN cars first, then newest photo activity (current cars), then host prefs.
  const { rows } = await pool.query<{ vehicle_id: number }>(
    `SELECT p.vehicle_id
     FROM photos p
     LEFT JOIN listings l ON l.id = p.listing_id
     WHERE p.stored_path IS NULL
       AND p.source_url NOT ILIKE '%copart.com%'
       AND p.source_url NOT ILIKE '%iaai.com%'
     GROUP BY p.vehicle_id
     HAVING (
       $2::int = 0
       OR (
         SELECT count(*)::int FROM photos px
         WHERE px.vehicle_id = p.vehicle_id
           AND px.stored_path IS NOT NULL
           AND btrim(px.stored_path) <> ''
           AND px.stored_path NOT LIKE 'mirror-failed:%'
       ) < $2::int
     )
     ORDER BY
       (
         SELECT count(*)::int FROM photos px
         WHERE px.vehicle_id = p.vehicle_id
           AND px.stored_path IS NOT NULL
           AND btrim(px.stored_path) <> ''
           AND px.stored_path NOT LIKE 'mirror-failed:%'
       ) ASC,
       max(p.created_at) DESC NULLS LAST,
       CASE
         WHEN bool_or(p.source_url ILIKE '%import-motor.com%') THEN 0
         WHEN bool_or(
           l.source_id LIKE 'im-%'
           OR l.source_url ILIKE '%import-motor.com/v/%'
         ) THEN 1
         WHEN bool_or(p.source_url ILIKE '%imagebox.autowini.com%' OR p.source_url ILIKE '%image.autowini.com%') THEN 2
         ELSE 3
       END,
       p.vehicle_id DESC
     LIMIT $1`,
    [cap, maxPer],
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
  20,
  Math.max(1, Number(process.env.R2_MIRROR_VEHICLES_PER_BATCH ?? "4") || 4),
);
const VEHICLE_MIRROR_PARALLEL = Math.min(
  3,
  Math.max(1, Number(process.env.R2_MIRROR_VEHICLE_PARALLEL ?? "1") || 1),
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
