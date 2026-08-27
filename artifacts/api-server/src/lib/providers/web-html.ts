import type { NormalizedPhoto } from "@workspace/providers";

export const MARKET_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function fetchHtml(
  url: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ text: string; status: number; finalUrl: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": MARKET_UA,
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...extraHeaders,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  return { text: await res.text(), status: res.status, finalUrl: res.url };
}

export function extractNextData(html: string): unknown {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

export function extractNuxtData(html: string): unknown {
  const match =
    html.match(/window\.__NUXT__\s*=\s*([\s\S]*?);\s*<\/script>/) ||
    html.match(/<script>window\.__NUXT__=([\s\S]*?)<\/script>/);
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

export function mentionsVinLabel(text: string): boolean {
  return /(?:\bvin\b|chassis(?:\s*(?:no\.?|number|#))?|fahrgestell|차대번호|vehicle identification|numer\s*(?:vin|nadwozia)|n[o°]\s*(?:de\s*)?chassis)/i.test(
    text,
  );
}

/** Third-party / chrome assets that are never listing car photos. */
const PHOTO_JUNK_HOST =
  /mcusercontent\.com|mailchimp\.com|list-manage\.com|doubleclick\.net|googlesyndication\.com|googleadservices\.com|google-analytics\.com|facebook\.com|fbcdn\.net|twitter\.com|twimg\.com|linkedin\.com|pinterest\.com|tiktok\.com|hotjar\.com|clarity\.ms|cdninstagram\.com/i;

const PHOTO_JUNK_PATH =
  /logo|favicon|sprite|placeholder|badge|avatar|icon[-_/]|\/icons?\/|apple-touch|social|pixel|tracking|newsletter|banner[-_]?ad|btn[-_]|button|watermark|spinner|loader|emoji|carpoolkr\.com\/assets\/car\/(?:make|type)\//i;

/** Prefer same-site images; strip size variants so the same shot is not stored twice. */
export function photoIdentityKey(url: string): string {
  const raw = url.trim();
  // IAAI resizer / 360 retriever: identity lives in query params, not the path.
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./i, "");
    if (/vis\.iaai\.com$/i.test(host) && /\/resizer/i.test(parsed.pathname)) {
      const keys = parsed.searchParams.get("imageKeys") || "";
      if (keys) return `iaai-vis:${keys.toLowerCase()}`;
    }
    if (/mediaretriever\.iaai\.com$/i.test(host)) {
      const pk = (parsed.searchParams.get("partitionKey") || "").toLowerCase();
      const order = parsed.searchParams.get("imageOrder") || "";
      if (/threesixtyimageretriever/i.test(parsed.pathname) && pk) {
        return `iaai-360:${pk}:${order || "0"}`;
      }
      if (/interiorimageretriever/i.test(parsed.pathname) && pk) {
        return `iaai-pano:${pk}`;
      }
    }
  } catch {
    /* fall through */
  }

  let u = raw.split("#")[0]!.split("?")[0]!.trim().replace(/\/+$/, "").toLowerCase();
  u = u.replace(/\/w_\d+x\d+\//g, "/");
  u = u.replace(/\/\d{2,4}x\d{2,4}\//g, "/");
  u = u.replace(/\/(?:thumb|small|medium|large|preview|resized?)\//g, "/");
  // Dubicars CDN: /images/{hash}/dealer/file.jpeg → /images/dealer/file.jpeg
  u = u.replace(/\/images\/[a-f0-9]{4,12}\//g, "/images/");
  // Encar / Autowini style size suffixes in filename
  u = u.replace(/_(?:thumb|small|medium|large|orig)\.(jpe?g|webp|png)$/i, ".$1");

  // Import Motor CDN: cars vs cars2 + rotating lot folders all host the same VIN-N shot.
  // https://cars2.import-motor.com/copart/chevrolet/equinox/2025/61303996/3GN7…-1.webp
  const imShot = u.match(
    /cars2?\.import-motor\.com\/(encar|copart|iaa)\/.+?\/([a-hj-npr-z0-9]{17})-(\d+)\.(jpe?g|webp|png)$/i,
  );
  if (imShot) {
    return `im-cdn:${imShot[1]}:${imShot[2]}:${imShot[3]}.${imShot[4]}`;
  }
  // Collapse cars / cars2 host for any other IM media path.
  u = u.replace(/\/\/cars2\.import-motor\.com\//i, "//cars.import-motor.com/");

  return u;
}

export function isJunkPhotoUrl(url: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return true;
  if (/\.(svg)(\?|$)/i.test(url)) return true;
  // Bare IAAI deepzoom / viewer shells are not real image assets.
  if (/vis\.iaai\.com\/deepzoom\/?$/i.test(url.split("?")[0]!)) return true;
  if (/Home\/ThreeSixtyView/i.test(url)) return true;
  try {
    const host = new URL(url).hostname;
    if (PHOTO_JUNK_HOST.test(host)) return true;
  } catch {
    return true;
  }
  if (PHOTO_JUNK_PATH.test(url)) return true;
  return false;
}

function photoSizeScore(url: string): number {
  const m = url.match(/\/(?:w_)?(\d{2,4})x(\d{2,4})\//i);
  if (!m) return 0;
  return Number(m[1]) * Number(m[2]);
}

export function asPhotos(urls: string[], max = 40): NormalizedPhoto[] {
  const best = new Map<string, { url: string; score: number }>();
  for (const raw of urls) {
    if (!raw || isJunkPhotoUrl(raw)) continue;
    const url = raw.split("?")[0]!.trim();
    if (!url) continue;
    const key = photoIdentityKey(url);
    const score = photoSizeScore(url);
    const prev = best.get(key);
    if (!prev || score > prev.score) best.set(key, { url, score });
  }
  const out: NormalizedPhoto[] = [];
  for (const { url } of best.values()) {
    out.push({ sourceUrl: url, isPrimary: out.length === 0, sortOrder: out.length });
    if (out.length >= max) break;
  }
  return out;
}

export function collectHttpImages(html: string, hostHint?: string, max = 40): string[] {
  const preferred: string[] = [];
  const other: string[] = [];
  const seen = new Set<string>();
  const push = (raw?: string) => {
    if (!raw) return;
    let cleaned = raw.replace(/\\u002F/g, "/").replace(/\\\//g, "/").split("?")[0]!.trim();
    if (cleaned.startsWith("//")) cleaned = `https:${cleaned}`;
    if (!/^https?:\/\//i.test(cleaned)) return;
    if (isJunkPhotoUrl(cleaned)) return;
    const key = photoIdentityKey(cleaned);
    if (seen.has(key)) {
      // Keep the larger size variant when we see the same shot again.
      const list = hostHint && cleaned.toLowerCase().includes(hostHint.toLowerCase()) ? preferred : other;
      const idx = list.findIndex((u) => photoIdentityKey(u) === key);
      if (idx >= 0 && photoSizeScore(cleaned) > photoSizeScore(list[idx]!)) list[idx] = cleaned;
      return;
    }
    seen.add(key);
    if (hostHint && cleaned.toLowerCase().includes(hostHint.toLowerCase())) preferred.push(cleaned);
    else other.push(cleaned);
  };
  for (const match of html.matchAll(
    /(?:https?:)?\/\/[^"'\\\s>]+\.(?:jpe?g|webp|png)(?:\?[^"'\\\s>]*)?/gi,
  )) {
    push(match[0]);
    if (preferred.length + other.length >= max * 4) break;
  }
  // When a host hint is set, never fall back to random third-party PNGs/icons.
  const picked = hostHint ? preferred : preferred.concat(other);
  return picked.slice(0, max);
}

export function deepGet(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^\d.]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export function firstRegEvent(raw: unknown): { eventType: "delivery"; description: string; occurredAt: Date } | undefined {
  const text = str(raw);
  if (!text) return undefined;
  const iso = text.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
  const ym = text.match(/(\d{2})\/(\d{4})/);
  let occurredAt: Date | undefined;
  if (iso) occurredAt = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3] ?? "1"));
  else if (ym) occurredAt = new Date(Number(ym[2]), Number(ym[1]) - 1, 1);
  if (!occurredAt || Number.isNaN(occurredAt.getTime())) return undefined;
  return { eventType: "delivery", description: `First registration ${text}`, occurredAt };
}

export function walkFind<T>(root: unknown, pred: (key: string, value: unknown) => T | undefined): T | undefined {
  const seen = new Set<unknown>();
  const stack: unknown[] = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item);
      continue;
    }
    for (const [key, value] of Object.entries(cur as Record<string, unknown>)) {
      const hit = pred(key, value);
      if (hit !== undefined) return hit;
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return undefined;
}
