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
  provider: "cloudflare";
  isPrimary: boolean;
  sortOrder: number;
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
    if (/ci\.encar\.com|encar\.com/i.test(host)) return "encar";
    if (/autowini\.com/i.test(host)) return "autowini";
    if (/bringatrailer\.com/i.test(host)) return "bringatrailer";
    if (/cars24\.com/i.test(host)) return "cars24";
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
      host.endsWith(".imgbb.com")
    );
  } catch {
    return /ibb\.co|imgbb\.com/i.test(url);
  }
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
    provider: provider as "cloudflare",
    isPrimary: Boolean(p.isPrimary),
    sortOrder: p.sortOrder ?? 0,
    width: p.width ?? null,
    height: p.height ?? null,
    group: normalizeGroup(p.photoGroup),
  };
}

/**
 * Client-safe display URL: Cloudflare CDN first, else a non–import-motor source.
 * Returns null when the only available URL is Import Motor (omit until mirrored).
 */
export function publicPhotoUrl(p: PhotoRowLike): string | null {
  const stored = p.storedPath?.trim() || null;
  if (stored && !isMirrorFailedPath(stored) && isHostedCdnUrl(stored)) return stored!;
  if (p.sourceUrl && /^https?:\/\//i.test(p.sourceUrl) && !isImportMotorPhotoUrl(p.sourceUrl)) {
    return rewriteSeznamSdnSourceUrl(p.sourceUrl);
  }
  return null;
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

    const pushSource = (bucket: PhotoOldEntry[], urls: Set<string>, keys: Set<string>) => {
      // Public/default: once Cloudflare hosts the frame, omit ephemeral/source twins.
      // Admin: keep source links so the Photos tab can show provider URLs under CDN thumbs.
      if (hasCdn && !keepSourceAlongsideCdn) return;
      if (!p.sourceUrl || !/^https?:\/\//i.test(p.sourceUrl)) return;
      if (!includeIm && isImportMotorPhotoUrl(p.sourceUrl)) return;
      if (isHostedCdnUrl(p.sourceUrl)) return;
      const sourceUrl = rewriteSeznamSdnSourceUrl(p.sourceUrl);
      if (seenIn(urls, keys, sourceUrl)) return;
      bucket.push({
        id: p.id,
        url: sourceUrl,
        provider: photoProviderLabel(sourceUrl),
        isPrimary: Boolean(p.isPrimary),
        sortOrder: p.sortOrder ?? 0,
        width: p.width ?? null,
        height: p.height ?? null,
        group,
      });
      track(urls, keys, sourceUrl);
    };

    if (group === "exterior_3d") {
      pushCdn(photosExterior3d, exteriorSeenUrls, exteriorSeenKeys);
      pushSource(photosExterior3dOld, exteriorSeenUrls, exteriorSeenKeys);
      continue;
    }

    // Flat photosNew / photosOld stay gallery-only — exterior 360 lives in dedicated arrays.
    pushCdn(photosNew, gallerySeenUrls, gallerySeenKeys);
    pushSource(photosOld, gallerySeenUrls, gallerySeenKeys);
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
