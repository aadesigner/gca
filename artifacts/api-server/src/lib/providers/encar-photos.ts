/** Encar listing photos are served via ci.encar.com CDN with resize query params. */
export const ENCAR_PHOTO_CDN = "https://ci.encar.com";

export type EncarPhotoSize = "thumb" | "card" | "display";

/** Encar list tiles / our grid cards / detail hero. */
const SIZES: Record<EncarPhotoSize, { rh: number; cw: number; ch: number }> = {
  thumb: { rh: 176, cw: 236, ch: 176 },
  card: { rh: 290, cw: 387, ch: 290 },
  display: { rh: 1650, cw: 2200, ch: 1650 },
};

function photoQuery(size: EncarPhotoSize, updateDateTime?: string | null): string {
  const dim = SIZES[size];
  const params = new URLSearchParams({
    impolicy: "heightRate",
    rh: String(dim.rh),
    cw: String(dim.cw),
    ch: String(dim.ch),
    cg: "Center",
  });
  if (updateDateTime) {
    const t = updateDateTime.replace(/\D/g, "").slice(0, 14);
    if (t) params.set("t", t);
  }
  return params.toString();
}

export function buildEncarPhotoUrl(
  path: string,
  size: EncarPhotoSize = "display",
  updateDateTime?: string | null,
): string {
  if (!path?.trim()) return path;

  let base: string;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    base = path.split("?")[0]!;
  } else if (path.startsWith("//")) {
    base = `https:${path.split("?")[0]!}`;
  } else {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    if (normalized.startsWith("/carpicture/")) {
      base = `${ENCAR_PHOTO_CDN}${normalized}`;
    } else if (normalized.startsWith("/carpicture")) {
      base = `${ENCAR_PHOTO_CDN}/carpicture${normalized}`;
    } else {
      base = `${ENCAR_PHOTO_CDN}${normalized}`;
    }
  }

  return `${base}?${photoQuery(size, updateDateTime)}`;
}

/** Rewrite an existing Encar CDN URL to another size without changing the path. */
export function resizeEncarPhotoUrl(url: string, size: EncarPhotoSize): string {
  if (!url?.trim()) return url;
  if (!/encar\.com/i.test(url)) return url;
  return buildEncarPhotoUrl(url, size);
}

function isPhotoPath(value: string): boolean {
  return /carpicture|ci\.encar\.com|\.(jpe?g|png|webp)(\?|$)/i.test(value);
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Encar `type` / `code`:
 *   001 exterior (cover lives here), 002 interior, 003–009 other car shots,
 *   010+ inspection / diagnosis — those must never be the primary.
 */
function photoTypeRank(type: unknown): number {
  const raw = String(type ?? "").trim();
  if (!raw) return 15;
  const n = parseInt(raw.replace(/\D/g, ""), 10);
  if (!Number.isFinite(n)) return 15;
  if (n <= 0) return 15;
  if (n === 1) return 1;
  if (n <= 9) return n;
  return 40 + n;
}

/** `{carId}_001.jpg` is Encar’s official cover; `_002` is second, etc. */
function photoSeqFromPath(path: string): number {
  const base = (path.split("?")[0] ?? path).replace(/\\/g, "/");
  const file = base.split("/").pop() ?? base;
  const m = file.match(/_(\d{2,4})(?:\.[a-z0-9]+)?$/i);
  return m ? Number(m[1]) : 9999;
}

type PhotoHit = {
  raw: string;
  ordering: number;
  typeRank: number;
  seq: number;
  index: number;
};

/** Collect unique Encar photo URLs from detail/view/search photo payloads. */
export function collectPhotoUrls(...sources: unknown[]): string[] {
  return collectPhotoUrlsAt("display", ...sources);
}

export function collectPhotoUrlsAt(size: EncarPhotoSize, ...sources: unknown[]): string[] {
  const hits: PhotoHit[] = [];
  let index = 0;

  const add = (raw: string, meta?: { ordering?: number; type?: unknown }) => {
    if (!raw?.trim()) return;
    if (
      !isPhotoPath(raw) &&
      !raw.startsWith("/") &&
      !raw.startsWith("http") &&
      !raw.startsWith("//")
    ) {
      return;
    }
    hits.push({
      raw,
      ordering: meta?.ordering ?? Number.MAX_SAFE_INTEGER,
      typeRank: photoTypeRank(meta?.type),
      seq: photoSeqFromPath(raw),
      index: index++,
    });
  };

  const visit = (value: unknown, depth = 0) => {
    if (value == null || depth > 6) return;
    if (typeof value === "string") {
      add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item && typeof item === "object") {
          const row = item as Record<string, unknown>;
          const path = row.path ?? row.location ?? row.url ?? row.imageUrl ?? row.src;
          if (typeof path === "string") {
            add(path, {
              ordering: num(row.ordering ?? row.order ?? row.sortOrder ?? row.seq) ?? i,
              type: row.type ?? row.code ?? row.photoType ?? row.photoCd,
            });
            return;
          }
        }
        visit(item, depth + 1);
      });
      return;
    }
    if (typeof value === "object") {
      const row = value as Record<string, unknown>;
      const path = row.path ?? row.location ?? row.url ?? row.imageUrl ?? row.src;
      if (typeof path === "string") {
        add(path, {
          ordering: num(row.ordering ?? row.order ?? row.sortOrder ?? row.seq),
          type: row.type ?? row.code ?? row.photoType ?? row.photoCd,
        });
        return;
      }
      const grouped = Object.keys(row).sort((a, b) => photoTypeRank(a) - photoTypeRank(b));
      for (const key of grouped) visit(row[key], depth + 1);
    }
  };

  for (const source of sources) visit(source);

  hits.sort((a, b) => {
    if (a.typeRank !== b.typeRank) return a.typeRank - b.typeRank;
    if (a.seq !== b.seq) return a.seq - b.seq;
    if (a.ordering !== b.ordering) return a.ordering - b.ordering;
    return a.index - b.index;
  });

  const seen = new Set<string>();
  const out: string[] = [];
  for (const hit of hits) {
    const url = buildEncarPhotoUrl(hit.raw, size);
    if (!url) continue;
    const key = url.split("?")[0]!.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/** Upgrade a stored Encar photo URL to high-resolution CDN parameters. */
export function upgradeEncarPhotoUrl(existingUrl: string): string {
  if (!existingUrl.includes("encar.com")) return existingUrl;
  return buildEncarPhotoUrl(existingUrl, "display");
}
