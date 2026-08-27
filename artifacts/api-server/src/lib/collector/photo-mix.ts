/**
 * Cap gallery size per VIN and interleave shots across listings.
 * 3D spin groups (exterior_3d / interior_3d) keep their own budgets so
 * swipe sequences are not truncated by the flat gallery mix.
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

function groupOf<T>(photo: MixablePhoto<T>): PhotoGroupName {
  const g = String(photo.photoGroup || "gallery");
  if (g === "exterior_3d" || g === "interior_3d") return g;
  return "gallery";
}

/**
 * Round-robin across listings (primary/early shots first within each listing).
 * Dedupes by identityKey across the whole vehicle gallery.
 */
export function selectMixedVehiclePhotos<T>(
  photos: MixablePhoto<T>[],
  max = MAX_VEHICLE_PHOTOS,
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

  const mixedGallery = mixGallery(gallery, max).map((photo, sortOrder) => ({
    ...photo,
    sortOrder,
    isPrimary: sortOrder === 0,
    photoGroup: "gallery" as const,
  }));

  return [...mixedGallery, ...exterior, ...interior];
}

function mixGallery<T>(photos: MixablePhoto<T>[], max: number): MixablePhoto<T>[] {
  if (photos.length === 0 || max <= 0) return [];

  const byListing = new Map<string, MixablePhoto<T>[]>();
  for (const photo of photos) {
    const key = photo.listingId == null ? "none" : String(photo.listingId);
    const bucket = byListing.get(key) ?? [];
    bucket.push(photo);
    byListing.set(key, bucket);
  }

  for (const bucket of byListing.values()) {
    bucket.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return 0;
    });
  }

  const queues = [...byListing.values()];
  queues.sort((a, b) => {
    const ap = a.some((p) => p.isPrimary) ? 0 : 1;
    const bp = b.some((p) => p.isPrimary) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return b.length - a.length;
  });

  const pointers = queues.map(() => 0);
  const selected: MixablePhoto<T>[] = [];
  const seen = new Set<string>();

  while (selected.length < max) {
    let progressed = false;
    for (let q = 0; q < queues.length; q++) {
      if (selected.length >= max) break;
      const queue = queues[q]!;
      let p = pointers[q]!;
      while (p < queue.length && seen.has(queue[p]!.identityKey)) p++;
      pointers[q] = p;
      if (p >= queue.length) continue;
      const candidate = queue[p]!;
      seen.add(candidate.identityKey);
      selected.push(candidate);
      pointers[q] = p + 1;
      progressed = true;
    }
    if (!progressed) break;
  }

  return selected;
}
