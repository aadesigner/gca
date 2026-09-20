/**
 * Split vehicle photos into Cloudflare (new) vs original provider (old) URLs,
 * plus optional 3D exterior / interior swipe sequences.
 *
 * Import Motor source URLs are stored in DB for internal use but must never be
 * exported to public API clients (tracking / hotlink risk). Admin may opt in.
 */

import { photoIdentityKey } from "./providers/web-html";
import {
  MAX_VEHICLE_PHOTOS,
  providerFrameOrder,
  selectMixedVehiclePhotos,
  VIN_GALLERY_OVERFLOW_SORT,
  type MixablePhoto,
} from "./collector/photo-mix";

export type PhotoGroupName = "gallery" | "exterior_3d" | "interior_3d";

export type PhotoRowLike = {
  id: number;
  sourceUrl: string;
  storedPath?: string | null;
  isPrimary?: boolean | null;
  sortOrder?: number | null;
  width?: number | null;
  height?: number | null;
  photoGroup?: string | null;
  listingId?: number | null;
};

export type PhotoNewEntry = {
  id: number;
  url: string;
  /** "cloudflare" when mirrored; otherwise provider label (copart, iaa, carstat, …). */
  provider: string;
  isPrimary: boolean;
  sortOrder: number;
  /** Provider URL frame rank — used when CDN url has no shot index. */
  frameOrder?: number;
  width: number | null;
  height: number | null;
  group: PhotoGroupName;
};

export type PhotoOldEntry = {
  id: number;
  url: string;
  provider: string;
  isPrimary: boolean;
  sortOrder: number;
  frameOrder?: number;
  width: number | null;
  height: number | null;
  group: PhotoGroupName;
};

/** CDN stock thumb for vehicles with no gallery (display only; crawls must not create these). */
export const NO_PHOTO_FOUND_URL =
  process.env.NO_PHOTO_FOUND_URL?.trim() ||
  `${(process.env.R2_PUBLIC_BASE_URL?.trim() || "https://imgsv.getcarapi.com").replace(/\/+$/, "")}/stock/no-photo-found.png`;

export function noPhotoStockEntry(): PhotoNewEntry {
  return {
    id: -1,
    url: NO_PHOTO_FOUND_URL,
    provider: "cloudflare",
    isPrimary: true,
    sortOrder: 0,
    width: 1280,
    height: 960,
    group: "gallery",
  };
}

/** If gallery is empty, inject the stock "No photo found" image for display. */
export function withNoPhotoFallback<T extends { photosNew: PhotoNewEntry[]; photosOld: PhotoOldEntry[] }>(
  split: T,
): T {
  const hasAny = (split.photosNew?.length ?? 0) > 0 || (split.photosOld?.length ?? 0) > 0;
  if (hasAny) return split;
  return {
    ...split,
    photosNew: [noPhotoStockEntry()],
  };
}

export type SplitPhotosOptions = {
  /**
   * When true, include import-motor.com source URLs in photosOld / *Old sequences
   * (admin / internal only). Default false — public clients never receive them.
   */
  includeImportMotorSources?: boolean;
  /**
   * When true, keep original source URLs in *Old even if a Cloudflare mirror exists.
   * Admin Photos tab needs these links under the CDN gallery.
   */
  keepSourceAlongsideCdn?: boolean;
};

/** True for import-motor.com and cars*.import-motor.com image/page hosts. */
export function isImportMotorPhotoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host === "import-motor.com" || host.endsWith(".import-motor.com");
  } catch {
    return /import-motor\.com/i.test(url);
  }
}

export function photoProviderLabel(sourceUrl: string): string {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
    if (/cars2?\.import-motor\.com|import-motor\.com/i.test(host)) return "import-motor";
    if (/cs\.copart\.com|copart\.com/i.test(host)) return "copart";
    if (/vis\.iaai\.com|mediaretriever\.iaai\.com|iaai\.com/i.test(host)) return "iaa";
    if (/carstat\.info/i.test(host)) return "carstat";
    if (/ci\.encar\.com|encar\.com/i.test(host)) return "encar";
    if (/autowini\.com/i.test(host)) return "autowini";
    if (/bringatrailer\.com/i.test(host)) return "bringatrailer";
    if (/cars24\.com/i.test(host)) return "cars24";
    if (/carpages\.ca/i.test(host)) return "carpages";
    if (/ontariocars\.ca/i.test(host)) return "ontariocars";
    if (/imgsv\.getcarapi\.com|r2\.dev/i.test(host)) return "cloudflare";
    const base = host.split(".").slice(-2).join(".");
    return base || host || "provider";
  } catch {
    return "provider";
  }
}

export function isHostedCdnUrl(url: string | null | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  return /imgsv\.getcarapi\.com|\.r2\.dev\//i.test(url);
}

/** Poison marker written when R2 mirror permanently failed — not a displayable URL. */
export function isMirrorFailedPath(path: string | null | undefined): boolean {
  return Boolean(path && /^mirror-failed:/i.test(path.trim()));
}

/**
 * Heal scrambled DB gallery order for API responses:
 * contiguous listing blocks in provider URL order, cap at MAX_VEHICLE_PHOTOS.
 * Overflow / non-selected listing frames are omitted from the VIN-facing set.
 */
export function reorderVehiclePhotosForApi<T extends PhotoRowLike>(photos: T[]): T[] {
  if (photos.length === 0) return photos;

  const mixable: MixablePhoto<T>[] = photos.map((p) => ({
    ...p,
    listingId: p.listingId ?? null,
    isPrimary: Boolean(p.isPrimary),
    sortOrder: p.sortOrder ?? 0,
    identityKey: photoIdentityKey(p.sourceUrl),
    sourceUrl: p.sourceUrl,
    photoGroup: p.photoGroup || "gallery",
  }));

  const selected = selectMixedVehiclePhotos(mixable, MAX_VEHICLE_PHOTOS);
  const byId = new Map(photos.map((p) => [p.id, p]));
  const out: T[] = [];
  for (const row of selected) {
    const orig = byId.get(row.id);
    if (!orig) continue;
    out.push({
      ...orig,
      sortOrder: row.sortOrder,
      isPrimary: row.isPrimary,
      photoGroup: row.photoGroup || orig.photoGroup || "gallery",
    });
  }
  return out;
}

/** True when a gallery row is VIN-facing (not per-listing overflow parking). */
export function isVinFacingGallerySort(sortOrder: number | null | undefined): boolean {
  return (sortOrder ?? 0) < VIN_GALLERY_OVERFLOW_SORT;
}


/** Copart / IAAI auction CDNs — keep as source links; never mirror to Cloudflare. */
export function isAuctionCdnPhotoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return (
      host === "copart.com" ||
      host.endsWith(".copart.com") ||
      host === "iaai.com" ||
      host.endsWith(".iaai.com")
    );
  } catch {
    return /(?:^|[./])(?:cs\.)?copart\.com|(?:^|[./])(?:vis\.|mediaretriever\.)?iaai\.com/i.test(url);
  }
}

/** Carstat lot-image API — mirrored to Cloudflare via CDP (CF blocks Node fetch). */
export function isCarstatPhotoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host === "carstat.info" || host.endsWith(".carstat.info");
  } catch {
    return /carstat\.info/i.test(url);
  }
}

/**
 * Durable provider URLs that are never mirrored to Cloudflare — emit as primary
 * gallery frames via source link (photosNew). Copart / IAAI only.
 * Carstat is mirrored to R2 (via CDP) and must not stay in this bucket.
 */
export function isPrimarySourcePhotoUrl(url: string | null | undefined): boolean {
  return isAuctionCdnPhotoUrl(url);
}

/** True when R2 should download and host this source URL. */
export function shouldMirrorPhotoUrl(url: string | null | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (isAuctionCdnPhotoUrl(url)) return false;
  if (isHostedCdnUrl(url)) return false;
  return true;
}

/** Hosts we drop from photosOld once a Cloudflare copy exists (catalog temp hosts). */
export function isEphemeralPhotoHost(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return (
      host === "ibb.co" ||
      host.endsWith(".ibb.co") ||
      host === "imgbb.com" ||
      host.endsWith(".imgbb.com") ||
      // Dealer inventory CDNs rotate/delete frames — never hotlink after crawl.
      host === "carpages.ca" ||
      host.endsWith(".carpages.ca") ||
      host === "ontariocars.ca" ||
      host.endsWith(".ontariocars.ca")
    );
  } catch {
    return /ibb\.co|imgbb\.com|carpages\.ca|ontariocars\.ca/i.test(url);
  }
}

/**
 * Client-safe display URL: Cloudflare CDN first.
 * Never return a URL we already know is gone (mirror-failed) or an unmirrored
 * ephemeral dealer CDN (Carpages etc.) — those 404 in the browser.
 */
export function publicPhotoUrl(p: PhotoRowLike): string | null {
  const stored = p.storedPath?.trim() || null;
  if (stored && !isMirrorFailedPath(stored) && isHostedCdnUrl(stored)) return stored!;
  // Permanent mirror poison (404/410 at source) — do not fall back to dead source_url.
  if (isMirrorFailedPath(stored)) return null;
  // Ephemeral inventory CDNs must be mirrored before public display.
  if (isEphemeralPhotoHost(p.sourceUrl)) return null;
  if (p.sourceUrl && /^https?:\/\//i.test(p.sourceUrl) && !isImportMotorPhotoUrl(p.sourceUrl)) {
    return rewriteAutowiniHotlinkUrl(rewriteSeznamSdnSourceUrl(p.sourceUrl));
  }
  return null;
}

function normalizeGroup(raw?: string | null): PhotoGroupName {
  if (raw === "exterior_3d" || raw === "interior_3d") return raw;
  return "gallery";
}

function mapEntry(
  p: PhotoRowLike,
  url: string,
  provider: string,
): PhotoNewEntry | PhotoOldEntry {
  return {
    id: p.id,
    url,
    provider,
    isPrimary: Boolean(p.isPrimary),
    sortOrder: p.sortOrder ?? 0,
    frameOrder: providerFrameOrder(p.sourceUrl, p.sortOrder ?? 0),
    width: p.width ?? null,
    height: p.height ?? null,
    group: normalizeGroup(p.photoGroup),
  };
}

/** Seznam SDN raw object URLs 401 without `fl=exf`. */
export function rewriteSeznamSdnSourceUrl(url: string): string {
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
 * imagebox / image.autowini.com hotlink-block non-Autowini Referers (403).
 * Serve via our public /media/autowini* proxy until R2 mirror lands.
 */
export function rewriteAutowiniHotlinkUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const origin = (process.env.PUBLIC_SITE_URL || "https://getcarapi.com").replace(/\/+$/, "");
    if (host === "imagebox.autowini.com") {
      if (!parsed.pathname.startsWith("/upload/")) return url;
      return `${origin}/media/autowini${parsed.pathname}${parsed.search}`;
    }
    if (host === "image.autowini.com") {
      return `${origin}/media/autowini-img${parsed.pathname}${parsed.search}`;
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * Drop interior_3d entirely (product does not ship cabin 360).
 * Also drop exterior_3d whose listing has no real IAA gallery stills.
 */
export function filterOrphan360Photos<T extends PhotoRowLike>(photos: T[]): T[] {
  const iaaiListings = new Set<number>();
  for (const p of photos) {
    if ((p.photoGroup || "gallery") !== "gallery") continue;
    if (p.listingId == null) continue;
    if (/vis\.iaai\.com|mediaretriever\.iaai\.com/i.test(p.sourceUrl)) {
      iaaiListings.add(p.listingId);
    }
  }
  return photos.filter((p) => {
    const g = p.photoGroup || "gallery";
    if (g === "interior_3d") return false;
    if (g !== "exterior_3d") return true;
    if (p.listingId == null) return false;
    return iaaiListings.has(p.listingId);
  });
}

export function splitPhotosNewOld(
  photos: PhotoRowLike[],
  options: SplitPhotosOptions = {},
): {
  photosNew: PhotoNewEntry[];
  photosOld: PhotoOldEntry[];
  photosExterior3d: PhotoNewEntry[];
  photosExterior3dOld: PhotoOldEntry[];
} {
  const includeIm = Boolean(options.includeImportMotorSources);
  const keepSourceAlongsideCdn = Boolean(options.keepSourceAlongsideCdn);
  const photosNew: PhotoNewEntry[] = [];
  const photosOld: PhotoOldEntry[] = [];
  const photosExterior3d: PhotoNewEntry[] = [];
  const photosExterior3dOld: PhotoOldEntry[] = [];

  const gallerySeenUrls = new Set<string>();
  const gallerySeenKeys = new Set<string>();
  const exteriorSeenUrls = new Set<string>();
  const exteriorSeenKeys = new Set<string>();

  const track = (urls: Set<string>, keys: Set<string>, url: string) => {
    urls.add(url);
    keys.add(photoIdentityKey(url));
  };
  const seenIn = (urls: Set<string>, keys: Set<string>, url: string) =>
    urls.has(url) || keys.has(photoIdentityKey(url));

  for (const p of photos) {
    const storedRaw = p.storedPath?.trim() || null;
    const stored = storedRaw && !isMirrorFailedPath(storedRaw) ? storedRaw : null;
    const group = normalizeGroup(p.photoGroup);
    const hasCdn = isHostedCdnUrl(stored);

    // Interior 360 is retired — never emit in API JSON.
    if (group === "interior_3d") continue;

    const pushCdn = (bucket: PhotoNewEntry[], urls: Set<string>, keys: Set<string>) => {
      if (!hasCdn || !stored || seenIn(urls, keys, stored)) return;
      bucket.push(mapEntry(p, stored, "cloudflare") as PhotoNewEntry);
      track(urls, keys, stored);
    };

    const resolveSourceUrl = (): string | null => {
      if (!p.sourceUrl || !/^https?:\/\//i.test(p.sourceUrl)) return null;
      if (!includeIm && isImportMotorPhotoUrl(p.sourceUrl)) return null;
      if (isHostedCdnUrl(p.sourceUrl)) return null;
      return keepSourceAlongsideCdn
        ? rewriteSeznamSdnSourceUrl(p.sourceUrl)
        : rewriteAutowiniHotlinkUrl(rewriteSeznamSdnSourceUrl(p.sourceUrl));
    };

    const pushSource = (
      bucket: PhotoOldEntry[] | PhotoNewEntry[],
      urls: Set<string>,
      keys: Set<string>,
      asPrimary: boolean,
    ) => {
      // Public/default: once Cloudflare hosts the frame, omit ephemeral/source twins.
      // Admin: keep source links so the Photos tab can show provider URLs under CDN thumbs.
      if (hasCdn && !keepSourceAlongsideCdn) return;
      // Never emit known-dead or unmirrored ephemeral inventory CDNs to public clients.
      if (!keepSourceAlongsideCdn) {
        if (isMirrorFailedPath(storedRaw)) return;
        if (isEphemeralPhotoHost(p.sourceUrl)) return;
      } else if (isMirrorFailedPath(storedRaw) && isEphemeralPhotoHost(p.sourceUrl)) {
        // Admin: skip clearly dead ephemeral frames (avoid broken thumbs in Photos tab).
        return;
      }
      const sourceUrl = resolveSourceUrl();
      if (!sourceUrl) return;
      if (seenIn(urls, keys, sourceUrl)) return;
      const provider = photoProviderLabel(p.sourceUrl);
      bucket.push({
        id: p.id,
        url: sourceUrl,
        provider: asPrimary ? provider : provider,
        isPrimary: Boolean(p.isPrimary),
        sortOrder: p.sortOrder ?? 0,
        frameOrder: providerFrameOrder(p.sourceUrl, p.sortOrder ?? 0),
        width: p.width ?? null,
        height: p.height ?? null,
        group,
      } as PhotoNewEntry);
      track(urls, keys, sourceUrl);
    };

    if (group === "exterior_3d") {
      pushCdn(photosExterior3d, exteriorSeenUrls, exteriorSeenKeys);
      // Never-mirrored auction/carstat 360 stills stay primary when no CDN copy.
      if (!hasCdn && isPrimarySourcePhotoUrl(p.sourceUrl)) {
        pushSource(photosExterior3d, exteriorSeenUrls, exteriorSeenKeys, true);
      } else {
        pushSource(photosExterior3dOld, exteriorSeenUrls, exteriorSeenKeys, false);
      }
      continue;
    }

    // Flat photosNew / photosOld stay gallery-only — exterior 360 lives in dedicated arrays.
    pushCdn(photosNew, gallerySeenUrls, gallerySeenKeys);
    // Copart / IAAI / Carstat (and other never-mirrored durable hosts): primary gallery via src.
    if (!hasCdn && isPrimarySourcePhotoUrl(p.sourceUrl)) {
      pushSource(photosNew, gallerySeenUrls, gallerySeenKeys, true);
    } else {
      pushSource(photosOld, gallerySeenUrls, gallerySeenKeys, false);
    }
  }

  const byOrder = <T extends { sortOrder: number; id: number }>(a: T, b: T) =>
    a.sortOrder - b.sortOrder || a.id - b.id;

  photosNew.sort(byOrder);
  photosOld.sort(byOrder);
  photosExterior3d.sort(byOrder);
  photosExterior3dOld.sort(byOrder);

  return {
    photosNew,
    photosOld,
    photosExterior3d,
    photosExterior3dOld,
  };
}
