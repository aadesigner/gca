/**
 * Keep gallery / 360 frames that belong to this listing's lot/stock id.
 * Blocks Salvagebid "similar lots" thumbs and related-car IAA 360 iframes.
 */

export function listingLotPins(sourceId: string | null | undefined): string[] {
  const raw = String(sourceId ?? "")
    .replace(/^im-/i, "")
    .trim();
  if (!raw) return [];
  const pins = new Set<string>();
  const head = raw.split(/[-_/]/)[0] ?? "";
  if (/^\d{6,}$/.test(head)) pins.add(head);
  if (/^\d{6,}$/.test(raw)) pins.add(raw);
  const nested = raw.match(/(\d{6,})/g);
  if (nested) {
    for (const n of nested) pins.add(n);
  }
  return [...pins];
}

/**
 * Auction stock / lot id embedded in a photo URL, when present.
 * Returns undefined when the URL has no verifiable stock token.
 */
export function auctionStockIdFromPhotoUrl(url: string): string | undefined {
  const u = String(url ?? "");
  if (!u) return undefined;

  // Salvagebid / Copart-style Amazon vehimg: .../45405590-1L.jpg
  const vehimg = u.match(/\/(\d{6,})-\d{0,3}[A-Za-z]?(?=\.(?:jpe?g|webp|png)(?:\?|$))/i);
  if (vehimg?.[1]) return vehimg[1];

  // IAA ThreeSixty / resizer
  try {
    const parsed = new URL(u);
    const pk = parsed.searchParams.get("partitionKey");
    if (pk && /^\d{6,}$/.test(pk)) return pk;
    const keys = parsed.searchParams.get("imageKeys") || parsed.searchParams.get("imageKey") || "";
    const m = decodeURIComponent(keys).match(/^(\d{6,})(?:~|%7E)/i);
    if (m?.[1]) return m[1];
  } catch {
    /* ignore */
  }

  const iaaiPath = u.match(/\/iaai\/[^/]+\/[^/]+\/\d{4}\/(\d{6,})\//i)?.[1];
  if (iaaiPath) return iaaiPath;

  const copartPath = u.match(/\/copart\/[^/]+\/[^/]+\/\d{4}\/(\d{6,})\//i)?.[1];
  if (copartPath) return copartPath;

  const encar = u.match(/carpicture\d*\/pic\d+\/(\d{6,})_/i)?.[1];
  if (encar) return encar;

  return undefined;
}

/** True when URL has no stock token, or the token matches one of the listing pins. */
export function photoMatchesListingLot(
  url: string,
  sourceId: string | null | undefined,
): boolean {
  // Encar recars keep the previous lot id in the CDN filename. The Encar-specific
  // gallery filter decides whether that still belongs to this listing.
  if (/ci\.encar\.com|img\.encar\.com|\/carpicture/i.test(url)) return true;
  const stock = auctionStockIdFromPhotoUrl(url);
  if (!stock) return true;
  const pins = listingLotPins(sourceId);
  if (pins.length === 0) return true;
  return pins.includes(stock);
}

const ENCAR_PHOTO = /ci\.encar\.com|img\.encar\.com|cars2?\.import-motor\.com\/encar\//i;
const US_AUCTION_PHOTO =
  /cs\.copart\.com|vis\.iaai\.com|cars2?\.import-motor\.com\/(?:copart|iaai?)\//i;

export function listingPhotoMarket(
  origin?: string | null,
  photos: Array<{ sourceUrl: string }> = [],
): "us" | "kr" | undefined {
  const o = String(origin ?? "").toLowerCase();
  if (o === "copart" || o === "iaa") return "us";
  if (o === "encar" || o === "autowini") return "kr";
  const us = photos.some((p) => US_AUCTION_PHOTO.test(p.sourceUrl));
  const krMirror = photos.some((p) => /cars2?\.import-motor\.com\/encar\//i.test(p.sourceUrl));
  if (us && !krMirror) return "us";
  if (krMirror && !us) return "kr";
  if (us && krMirror) return "us";
  return undefined;
}

/**
 * Import Motor related cards mix Encar thumbs onto Copart/IAA lots (and the reverse).
 * Keep only the market that belongs to this listing.
 */
export function filterCrossMarketPhotos<T extends { sourceUrl: string }>(
  photos: T[],
  origin?: string | null,
): T[] {
  if (!photos.length) return photos;
  const market = listingPhotoMarket(origin, photos);
  if (market === "us") return photos.filter((p) => !ENCAR_PHOTO.test(p.sourceUrl));
  if (market === "kr") return photos.filter((p) => !US_AUCTION_PHOTO.test(p.sourceUrl));
  return photos;
}

export function filterCrossMarketListingPhotos<T extends { sourceUrl: string; listingId?: number | null }>(
  photos: T[],
  listingOriginById: Map<number, string | null | undefined> | Record<number, string | null | undefined>,
): T[] {
  const getOrigin =
    listingOriginById instanceof Map
      ? (id: number) => listingOriginById.get(id)
      : (id: number) => listingOriginById[id];
  const byListing = new Map<number | "none", T[]>();
  for (const photo of photos) {
    const key = photo.listingId == null ? "none" : photo.listingId;
    const list = byListing.get(key) ?? [];
    list.push(photo);
    byListing.set(key, list);
  }
  const out: T[] = [];
  for (const [key, rows] of byListing) {
    if (key === "none") {
      out.push(...rows);
      continue;
    }
    out.push(...filterCrossMarketPhotos(rows, getOrigin(key)));
  }
  return out;
}

/**
 * Drop frames whose embedded lot/stock id disagrees with listings.source_id.
 * 1×1 placeholders and empty URLs are also removed.
 */
export function filterPhotosToListingLot<T extends { sourceUrl: string }>(
  sourceId: string | null | undefined,
  photos: T[],
): T[] {
  if (!photos.length) return photos;
  const pins = listingLotPins(sourceId);
  const out: T[] = [];
  for (const photo of photos) {
    const url = String(photo.sourceUrl ?? "").trim();
    if (!url) continue;
    if (/^data:image\/gif/i.test(url)) continue;
    if (/1x1|pixel\.gif|spacer\.gif/i.test(url)) continue;
    if (pins.length > 0 && !photoMatchesListingLot(url, sourceId)) continue;
    out.push(photo);
  }
  return out;
}
