/**
 * Split vehicle photos into Cloudflare (new) vs original provider (old) URLs,
 * plus optional 3D exterior / interior swipe sequences.
 *
 * Import Motor source URLs are stored in DB for internal use but must never be
 * exported to public API clients (tracking / hotlink risk). Admin may opt in.
 */

import { photoIdentityKey } from "./providers/web-html";

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

export type SplitPhotosOptions = {
  /**
   * When true, include import-motor.com source URLs in photosOld / *Old sequences
   * (admin / internal only). Default false — public clients never receive them.
   */
  includeImportMotorSources?: boolean;
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
  if (isHostedCdnUrl(stored)) return stored!;
  if (p.sourceUrl && /^https?:\/\//i.test(p.sourceUrl) && !isImportMotorPhotoUrl(p.sourceUrl)) {
    return p.sourceUrl;
  }
  return null;
}

export function splitPhotosNewOld(
  photos: PhotoRowLike[],
  options: SplitPhotosOptions = {},
): {
  photosNew: PhotoNewEntry[];
  photosOld: PhotoOldEntry[];
  photosExterior3d: PhotoNewEntry[];
  photosInterior3d: PhotoNewEntry[];
  photosExterior3dOld: PhotoOldEntry[];
  photosInterior3dOld: PhotoOldEntry[];
} {
  const includeIm = Boolean(options.includeImportMotorSources);
  const photosNew: PhotoNewEntry[] = [];
  const photosOld: PhotoOldEntry[] = [];
  const seenUrls = new Set<string>();
  const seenKeys = new Set<string>();

  const remember = (url: string) => {
    seenUrls.add(url);
    seenKeys.add(photoIdentityKey(url));
  };
  const alreadySeen = (url: string) =>
    seenUrls.has(url) || seenKeys.has(photoIdentityKey(url));

  for (const p of photos) {
    const stored = p.storedPath?.trim() || null;
    const group = normalizeGroup(p.photoGroup);
    const hasCdn = isHostedCdnUrl(stored);

    if (hasCdn && stored && !alreadySeen(stored)) {
      photosNew.push(mapEntry(p, stored, "cloudflare") as PhotoNewEntry);
      remember(stored);
    }

    if (p.sourceUrl && /^https?:\/\//i.test(p.sourceUrl)) {
      if (!includeIm && isImportMotorPhotoUrl(p.sourceUrl)) continue;
      if (isHostedCdnUrl(p.sourceUrl)) continue;
      if (alreadySeen(p.sourceUrl)) continue;
      photosOld.push({
        id: p.id,
        url: p.sourceUrl,
        provider: photoProviderLabel(p.sourceUrl),
        isPrimary: Boolean(p.isPrimary),
        sortOrder: p.sortOrder ?? 0,
        width: p.width ?? null,
        height: p.height ?? null,
        group,
      });
      remember(p.sourceUrl);
    }
  }

  const byOrder = <T extends { sortOrder: number; id: number }>(a: T, b: T) =>
    a.sortOrder - b.sortOrder || a.id - b.id;

  photosNew.sort(byOrder);
  photosOld.sort(byOrder);

  const sequenceFor = (group: PhotoGroupName): PhotoNewEntry[] => {
    const seqSeenUrls = new Set<string>();
    const seqSeenKeys = new Set<string>();
    const seqAlreadySeen = (url: string) =>
      seqSeenUrls.has(url) ||
      seqSeenKeys.has(photoIdentityKey(url)) ||
      seenUrls.has(url) ||
      seenKeys.has(photoIdentityKey(url));

    return photos
      .filter((p) => normalizeGroup(p.photoGroup) === group)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
      .flatMap((p) => {
        const stored = p.storedPath?.trim() || null;
        if (isHostedCdnUrl(stored) && !seqAlreadySeen(stored!)) {
          seqSeenUrls.add(stored!);
          seqSeenKeys.add(photoIdentityKey(stored!));
          return [mapEntry(p, stored!, "cloudflare") as PhotoNewEntry];
        }
        if (
          !isHostedCdnUrl(stored) &&
          p.sourceUrl &&
          /^https?:\/\//i.test(p.sourceUrl) &&
          (includeIm || !isImportMotorPhotoUrl(p.sourceUrl)) &&
          !seqAlreadySeen(p.sourceUrl)
        ) {
          seqSeenUrls.add(p.sourceUrl);
          seqSeenKeys.add(photoIdentityKey(p.sourceUrl));
          return [mapEntry(p, p.sourceUrl, photoProviderLabel(p.sourceUrl)) as PhotoNewEntry];
        }
        return [];
      });
  };

  const photosExterior3d = sequenceFor("exterior_3d");
  const photosInterior3d = sequenceFor("interior_3d");
  const photosExterior3dOld = photosOld.filter((p) => p.group === "exterior_3d");
  const photosInterior3dOld = photosOld.filter((p) => p.group === "interior_3d");

  // Keep flat photosNew/photosOld as gallery-first (UI default), then append 3d.
  // Clients that want swipe sequences should prefer photosExterior3d / photosInterior3d.
  return {
    photosNew,
    photosOld,
    photosExterior3d,
    photosInterior3d,
    photosExterior3dOld,
    photosInterior3dOld,
  };
}
