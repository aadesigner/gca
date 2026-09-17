/**
 * Cap gallery size per VIN.
 *
 * VIN-facing gallery = contiguous listing blocks in provider order:
 *  1. Preferred / canonical listing (full gallery, up to max)
 *  2. Other listings as following blocks if room remains
 *
 * Never interleave frames from different listings by colliding sortOrder,
 * and never randomly sample a 4-photo head.
 */

export const MAX_VEHICLE_PHOTOS = 40;
export const MAX_EXTERIOR_3D_PHOTOS = 72;
/** @deprecated Kept for tests/callers; mix no longer uses a short prepend head. */
export const NEW_LISTING_PREPEND_COUNT = 4;
/** Gallery rows at/above this sortOrder are per-listing overflow, not VIN-facing. */
export const VIN_GALLERY_OVERFLOW_SORT = 10_000;

export type PhotoGroupName = "gallery" | "exterior_3d" | "interior_3d";

export type MixablePhoto<T> = T & {
  listingId: number | null;
  isPrimary: boolean;
  sortOrder: number;
  identityKey: string;
  photoGroup?: PhotoGroupName | string | null;
  sourceUrl?: string | null;
};

export type ListingPhotoMeta = {
  listingId: number;
  sourceId?: string | null;
  isActive?: boolean | null;
};

const CATALOG_SOURCE = /^(kmcheck|carstat|import|getcarapi):/i;
/** BidDrive / aggregator lot paths — mirrors, not primary marketplace galleries. */
const MIRROR_SOURCE = /^(lot|listing)\//i;

function groupOf<T>(photo: MixablePhoto<T>): PhotoGroupName {
  const g = String(photo.photoGroup || "gallery");
  if (g === "exterior_3d" || g === "interior_3d") return g;
  return "gallery";
}

/** True when listing is an aggregator mirror (BidDrive lot/listing) rather than origin market. */
export function isMirrorPhotoListing(meta?: ListingPhotoMeta | null): boolean {
  const sourceId = String(meta?.sourceId ?? "");
  if (MIRROR_SOURCE.test(sourceId)) return true;
  if (CATALOG_SOURCE.test(sourceId)) return true;
  return false;
}

/** Score a listing from its photo CDN hosts when listing meta is missing / incomplete. */
function listingUrlHostScore<T>(photos: MixablePhoto<T>[], listingId: number | "none"): number {
  if (listingId === "none") return 0;
  const urls = photos.filter((p) => p.listingId === listingId).map((p) => String(p.sourceUrl ?? ""));
  if (urls.length === 0) return 0;
  let score = 0;
  const any = (re: RegExp) => urls.some((u) => re.test(u));
  if (any(/ci\.encar\.com|encar\.com/i)) score += 120;
  if (any(/import-motor\.com/i)) score += 100;
  if (any(/japanesecartrade\.com|jct\.|autoplac/i)) score += 100;
  if (any(/carstat\.info/i)) score += 90;
  if (any(/seobuk|kbchachacha|autowini\.com/i)) score += 80;
  if (any(/cdn\.thebidrive\.com/i)) score -= 250;
  if (any(/autowini\/catalog/i)) score -= 150;
  return score;
}

/** Prefer live marketplace listings over catalog / BidDrive mirror rows on the same VIN. */
export function pickCanonicalPhotoListing(
  photos: MixablePhoto<unknown>[],
  metaByListingId: Map<number, ListingPhotoMeta>,
  preferredListingId?: number | null,
): number | null {
  const counts = new Map<number, number>();
  for (const photo of photos) {
    if (photo.listingId == null) continue;
    counts.set(photo.listingId, (counts.get(photo.listingId) ?? 0) + 1);
  }
  const ids = [...counts.keys()];
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0]!;

  // Never force BidDrive/catalog crawl to head when a real marketplace gallery exists.
  let preferred = preferredListingId ?? null;
  if (preferred != null && isMirrorPhotoListing(metaByListingId.get(preferred))) {
    const hasMarketplace = ids.some(
      (id) => id !== preferred && !isMirrorPhotoListing(metaByListingId.get(id)),
    );
    if (hasMarketplace) preferred = null;
  }
  // Also demote preferred when URL hosts say it's BidDrive and another listing is Encar/IM.
  if (preferred != null) {
    const prefHost = listingUrlHostScore(photos, preferred);
    const better = ids.some((id) => id !== preferred && listingUrlHostScore(photos, id) > prefHost + 50);
    if (better && prefHost < 0) preferred = null;
  }

  const scored = ids.map((listingId) => {
    const meta = metaByListingId.get(listingId);
    const sourceId = String(meta?.sourceId ?? "");
    let score = (counts.get(listingId) ?? 0) * 10;
    if (meta?.isActive) score += 100;
    if (CATALOG_SOURCE.test(sourceId)) score -= 500;
    if (MIRROR_SOURCE.test(sourceId)) score -= 350;
    // Encar / numeric marketplace IDs beat aggregator mirrors.
    if (/^\d{5,}$/.test(sourceId)) score += 120;
    score += listingUrlHostScore(photos, listingId);
    if (preferred != null && listingId === preferred) score += 400;
    return { listingId, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.listingId;
}

/**
 * Natural frame order from provider URL when DB sortOrder was scrambled
 * (random mix / 10000+ overflow).
 */
export function providerFrameOrder(sourceUrl: string | null | undefined, fallback = 0): number {
  if (!sourceUrl) return fallback;
  const u = sourceUrl.toLowerCase();
  // Encar: …/42040331_024.jpg
  const encar = u.match(/_(\d{2,4})\.(?:jpe?g|webp|png|avif)(?:\?|$)/i);
  if (encar && /encar\.com|ci\.encar/i.test(u)) return Number(encar[1]);
  // BidDrive catalog: …/IC5373645/0.avif
  const bd = u.match(/\/(?:autowini\/catalog|encar|lots)\/[^/]+\/(\d+)\.(?:jpe?g|webp|png|avif)(?:\?|$)/i);
  if (bd) return Number(bd[1]);
  // Autowini / generic …/0.jpg trailing index
  const trail = u.match(/\/(\d{1,3})\.(?:jpe?g|webp|png|avif)(?:\?|$)/i);
  if (trail && !/\/\d{8,}\//.test(u)) return Number(trail[1]);
  // Import Motor VIN-N shot
  const im = u.match(/-(\d+)(?:-[a-f0-9]+)*\.(?:jpe?g|webp|png)(?:\?|$)/i);
  if (im && /import-motor\.com/i.test(u)) return Number(im[1]);
  // Carstat lot-image UUIDs are unordered — keep DB / crawl sortOrder.
  if (/carstat\.info\/api\/lot-image\//i.test(u)) return fallback;
  return fallback;
}

function listingBlockScore(
  listingId: number | "none",
  metaByListingId: Map<number, ListingPhotoMeta> | undefined,
  preferredListingId?: number | null,
  photoCount = 0,
  galleryPhotos?: MixablePhoto<unknown>[],
): number {
  if (listingId === "none") return -1_000;
  let score = photoCount * 10;
  const meta = metaByListingId?.get(listingId);
  const sourceId = String(meta?.sourceId ?? "");
  if (meta?.isActive) score += 100;
  if (CATALOG_SOURCE.test(sourceId)) score -= 500;
  if (MIRROR_SOURCE.test(sourceId)) score -= 350;
  if (/^\d{5,}$/.test(sourceId)) score += 120;
  if (galleryPhotos) score += listingUrlHostScore(galleryPhotos, listingId);
  if (preferredListingId != null && listingId === preferredListingId) score += 400;
  return score;
}

/** Sort one listing's gallery into original provider order. */
export function sortListingGallery<T>(photos: MixablePhoto<T>[]): MixablePhoto<T>[] {
  return [...photos].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) {
      // Only trust isPrimary when sortOrders look unpolluted.
      const bothClean =
        a.sortOrder < VIN_GALLERY_OVERFLOW_SORT && b.sortOrder < VIN_GALLERY_OVERFLOW_SORT;
      if (bothClean) return a.isPrimary ? -1 : 1;
    }
    const ao = providerFrameOrder(a.sourceUrl, a.sortOrder);
    const bo = providerFrameOrder(b.sourceUrl, b.sortOrder);
    if (ao !== bo) return ao - bo;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return 0;
  });
}

/** Pick up to `count` photos in gallery order (primary first, then provider order). */
export function pickOrderedPhotos<T>(photos: MixablePhoto<T>[], count: number): MixablePhoto<T>[] {
  if (count <= 0 || photos.length === 0) return [];
  return sortListingGallery(photos).slice(0, Math.min(count, photos.length));
}

/** @deprecated Prefer pickOrderedPhotos. */
export function pickRandomPhotos<T>(
  photos: MixablePhoto<T>[],
  count: number,
  _random: () => number = Math.random,
): MixablePhoto<T>[] {
  return pickOrderedPhotos(photos, count);
}

/** True when this listing's gallery includes real IAA auction stills (required for spin). */
function listingHasIaaiGalleryStills<T>(photos: MixablePhoto<T>[], listingId: number | null): boolean {
  if (listingId == null) return false;
  return photos.some((p) => {
    if (p.listingId !== listingId || groupOf(p) !== "gallery") return false;
    const url = String(p.sourceUrl ?? "");
    return /vis\.iaai\.com|mediaretriever\.iaai\.com/i.test(url);
  });
}

/**
 * VIN gallery mix:
 * - Preferred listing → full contiguous gallery first (provider order).
 * - Remaining slots → other listings as contiguous blocks (canonical score).
 * - No preferred → canonical listing first, then others.
 */
export function selectMixedVehiclePhotos<T>(
  photos: MixablePhoto<T>[],
  max = MAX_VEHICLE_PHOTOS,
  metaByListingId?: Map<number, ListingPhotoMeta>,
  preferredListingId?: number | null,
  _random: () => number = Math.random,
): MixablePhoto<T>[] {
  if (photos.length === 0) return [];

  const gallery = photos.filter((p) => groupOf(p) === "gallery");
  const exterior = photos
    .filter((p) => groupOf(p) === "exterior_3d" && listingHasIaaiGalleryStills(photos, p.listingId))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, MAX_EXTERIOR_3D_PHOTOS)
    .map((photo, i) => ({ ...photo, sortOrder: i, isPrimary: false, photoGroup: "exterior_3d" as const }));

  const meta = metaByListingId ?? new Map();
  // Resolve preferred through canonical picker so BidDrive never steals Encar head.
  const preferred =
    preferredListingId != null
      ? pickCanonicalPhotoListing(gallery, meta, preferredListingId)
      : pickCanonicalPhotoListing(gallery, meta, null);

  const mixedGallery = buildContiguousGallery(gallery, max, meta, preferred);

  const trimmedGallery = mixedGallery.map((photo, sortOrder) => ({
    ...photo,
    sortOrder,
    isPrimary: sortOrder === 0,
    photoGroup: "gallery" as const,
  }));

  return [...trimmedGallery, ...exterior];
}

function buildContiguousGallery<T>(
  gallery: MixablePhoto<T>[],
  max: number,
  metaByListingId: Map<number, ListingPhotoMeta> | undefined,
  preferredListingId: number | null,
): MixablePhoto<T>[] {
  if (gallery.length === 0 || max <= 0) return [];

  const byListing = new Map<number | "none", MixablePhoto<T>[]>();
  for (const photo of gallery) {
    const key = photo.listingId ?? "none";
    const bucket = byListing.get(key) ?? [];
    bucket.push(photo);
    byListing.set(key, bucket);
  }

  const blocks = [...byListing.entries()].map(([listingId, block]) => ({
    listingId,
    sorted: sortListingGallery(block),
    score: listingBlockScore(listingId, metaByListingId, preferredListingId, block.length, gallery),
  }));

  blocks.sort((a, b) => {
    if (preferredListingId != null) {
      if (a.listingId === preferredListingId && b.listingId !== preferredListingId) return -1;
      if (b.listingId === preferredListingId && a.listingId !== preferredListingId) return 1;
    }
    return b.score - a.score;
  });

  const selected: MixablePhoto<T>[] = [];
  const seen = new Set<string>();
  for (const { sorted } of blocks) {
    for (const photo of sorted) {
      if (selected.length >= max) break;
      if (seen.has(photo.identityKey)) continue;
      seen.add(photo.identityKey);
      selected.push(photo);
    }
    if (selected.length >= max) break;
  }
  return selected;
}
