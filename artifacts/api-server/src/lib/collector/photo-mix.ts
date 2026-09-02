/**
 * Cap gallery size per VIN. Use photos from one canonical listing — never
 * interleave galleries from different listings (catalog imports vs live crawl).
 * 3D spin groups keep their own budgets.
 */

export const MAX_VEHICLE_PHOTOS = 40;
export const MAX_EXTERIOR_3D_PHOTOS = 72;
export const MAX_INTERIOR_3D_PHOTOS = 72;

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
    return { listingId, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.listingId;
}

/**
 * Gallery from a single canonical listing; deduped by identityKey.
 * 3D groups are kept from all listings (usually one source).
 */
export function selectMixedVehiclePhotos<T>(
  photos: MixablePhoto<T>[],
  max = MAX_VEHICLE_PHOTOS,
  metaByListingId?: Map<number, ListingPhotoMeta>,
): MixablePhoto<T>[] {
  if (photos.length === 0) return [];

  let gallery = photos.filter((p) => groupOf(p) === "gallery");
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

  const meta =
    metaByListingId ??
    new Map<number, ListingPhotoMeta>(
      [...new Set(gallery.map((p) => p.listingId).filter((id): id is number => id != null))].map((listingId) => [
        listingId,
        { listingId },
      ]),
    );
  const canonical = pickCanonicalPhotoListing(gallery, meta);
  if (canonical != null) {
    gallery = gallery.filter((p) => p.listingId === canonical);
  }

  const trimmedGallery = trimGallery(gallery, max).map((photo, sortOrder) => ({
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
