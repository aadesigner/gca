/**
 * Cap gallery size per VIN.
 *
 * When a new listing contributes photos to an existing VIN, prepend a small
 * random sample from that listing (not positions 1–4 in order, not interleaved
 * new/old/new/old). Older listing photos stay as a block after the head.
 * 3D spin groups keep their own budgets.
 */

export const MAX_VEHICLE_PHOTOS = 40;
export const MAX_EXTERIOR_3D_PHOTOS = 72;
export const MAX_INTERIOR_3D_PHOTOS = 72;
/** How many photos a new listing update prepends onto an existing VIN gallery. */
export const NEW_LISTING_PREPEND_COUNT = 4;

export type PhotoGroupName = "gallery" | "exterior_3d" | "interior_3d";

export type MixablePhoto<T> = T & {
  listingId: number | null;
  isPrimary: boolean;
  sortOrder: number;
  identityKey: string;
  photoGroup?: PhotoGroupName | string | null;
};

export type ListingPhotoMeta = {
  listingId: number;
  sourceId?: string | null;
  isActive?: boolean | null;
};

const CATALOG_SOURCE = /^(kmcheck|carstat|import|getcarapi):/i;

function groupOf<T>(photo: MixablePhoto<T>): PhotoGroupName {
  const g = String(photo.photoGroup || "gallery");
  if (g === "exterior_3d" || g === "interior_3d") return g;
  return "gallery";
}

/** Prefer live marketplace listings over catalog mirror rows on the same VIN. */
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

  const scored = ids.map((listingId) => {
    const meta = metaByListingId.get(listingId);
    const sourceId = String(meta?.sourceId ?? "");
    let score = (counts.get(listingId) ?? 0) * 10;
    if (meta?.isActive) score += 100;
    if (CATALOG_SOURCE.test(sourceId)) score -= 500;
    if (/^\d+$/.test(sourceId)) score += 50;
    if (preferredListingId != null && listingId === preferredListingId) score += 400;
    return { listingId, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.listingId;
}

function shuffleInPlace<T>(items: T[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
}

/** Pick up to `count` photos at random (not first N by sortOrder). */
export function pickRandomPhotos<T>(photos: MixablePhoto<T>[], count: number, random: () => number = Math.random): MixablePhoto<T>[] {
  if (count <= 0 || photos.length === 0) return [];
  const pool = [...photos];
  shuffleInPlace(pool, random);
  return pool.slice(0, Math.min(count, pool.length));
}

/**
 * VIN gallery mix:
 * - New listing on an existing VIN → prepend NEW_LISTING_PREPEND_COUNT random
 *   photos from that listing, then older listings' photos as a block.
 * - First / only listing → full gallery (trimmed).
 * - No preferred listing (reconcile) → keep existing order across listings.
 * 3D groups are kept from all listings (usually one source).
 */
export function selectMixedVehiclePhotos<T>(
  photos: MixablePhoto<T>[],
  max = MAX_VEHICLE_PHOTOS,
  metaByListingId?: Map<number, ListingPhotoMeta>,
  preferredListingId?: number | null,
  random: () => number = Math.random,
): MixablePhoto<T>[] {
  if (photos.length === 0) return [];

  const gallery = photos.filter((p) => groupOf(p) === "gallery");
  const exterior = photos
    .filter((p) => groupOf(p) === "exterior_3d")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, MAX_EXTERIOR_3D_PHOTOS)
    .map((photo, i) => ({ ...photo, sortOrder: i, isPrimary: false, photoGroup: "exterior_3d" as const }));
  const interior = photos
    .filter((p) => groupOf(p) === "interior_3d")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, MAX_INTERIOR_3D_PHOTOS)
    .map((photo, i) => ({ ...photo, sortOrder: i, isPrimary: false, photoGroup: "interior_3d" as const }));

  void metaByListingId;

  let mixedGallery: MixablePhoto<T>[];

  if (preferredListingId != null) {
    const fromPreferred = gallery.filter((p) => p.listingId === preferredListingId);
    const fromOthers = gallery.filter((p) => p.listingId !== preferredListingId);

    if (fromPreferred.length > 0 && fromOthers.length > 0) {
      const head = pickRandomPhotos(fromPreferred, NEW_LISTING_PREPEND_COUNT, random);
      const headKeys = new Set(head.map((p) => p.identityKey));
      const rest = trimGallery(
        fromOthers.filter((p) => !headKeys.has(p.identityKey)),
        Math.max(0, max - head.length),
      );
      mixedGallery = [...head, ...rest];
    } else {
      mixedGallery = trimGallery(fromPreferred.length > 0 ? fromPreferred : gallery, max);
    }
  } else {
    // Reconcile / no crawl context: keep current order, do not collapse to one listing.
    mixedGallery = trimGallery(gallery, max);
  }

  const trimmedGallery = mixedGallery.map((photo, sortOrder) => ({
    ...photo,
    sortOrder,
    isPrimary: sortOrder === 0,
    photoGroup: "gallery" as const,
  }));

  return [...trimmedGallery, ...exterior, ...interior];
}

function trimGallery<T>(photos: MixablePhoto<T>[], max: number): MixablePhoto<T>[] {
  if (photos.length === 0 || max <= 0) return [];
  const sorted = [...photos].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return 0;
  });
  const selected: MixablePhoto<T>[] = [];
  const seen = new Set<string>();
  for (const photo of sorted) {
    if (selected.length >= max) break;
    if (seen.has(photo.identityKey)) continue;
    seen.add(photo.identityKey);
    selected.push(photo);
  }
  return selected;
}
