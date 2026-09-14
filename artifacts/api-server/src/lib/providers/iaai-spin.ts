import type { NormalizedPhoto } from "@workspace/providers";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const IAAI_VIS_RESIZER = "https://vis.iaai.com/resizer";
const IAAI_SPIN_MAX = 48;

export function iaaiSpinFrameUrl(stockId: string, kind: "STP" | "INT", index: number): string {
  return `${IAAI_VIS_RESIZER}?imageKeys=${stockId}~SID~${kind}~I${index}&width=845&height=633`;
}

export function iaaiExterior360Url(stockId: string, imageOrder: number): string {
  return `https://mediaretriever.iaai.com/api/ThreeSixtyImageRetriever?tenant=iaai&partitionKey=${stockId}&imageOrder=${imageOrder}`;
}

export function iaaiInteriorPanoUrl(stockId: string): string {
  return `https://mediaretriever.iaai.com/api/InteriorImageRetriever?tenant=iaai&partitionKey=${stockId}`;
}

/** Extract IAAI stock id from ThreeSixty iframe / keys on listing HTML.
 * Do NOT fall back to auction lot numbers — Copart and IAAI reuse overlapping
 * numeric IDs for different cars. Only accept an explicit IAA 360 key/partition.
 */
export function extractIaaiSpinStockId(html: string, _lot?: string): string | undefined {
  return (
    html.match(/vis\.iaai\.com\/Home\/ThreeSixtyView\?[^"'>\s]*keys=SID-(\d+)/i)?.[1] ||
    html.match(/ThreeSixtyView[^"'>\s]*SID-(\d+)/i)?.[1] ||
    html.match(/keys=SID-(\d+)~STP/i)?.[1] ||
    html.match(/mediaretriever\.iaai\.com\/api\/ThreeSixtyImageRetriever[^"'>\s]*partitionKey=(\d+)/i)?.[1] ||
    html.match(/vis\.iaai\.com\/resizer\?[^"'>\s]*imageKeys=(\d{6,})%7ESID/i)?.[1] ||
    html.match(/vis\.iaai\.com\/resizer\?[^"'>\s]*imageKeys=(\d{6,})~SID/i)?.[1] ||
    undefined
  );
}

/** Stock id from Import Motor / IAA gallery paths (`/iaai/.../YYYY/{stock}/`). */
export function extractIaaiStockFromUrls(urls: Array<string | null | undefined>): string | undefined {
  const counts = new Map<string, number>();
  for (const raw of urls) {
    if (!raw) continue;
    const fromPath = raw.match(/\/iaai\/[^/]+\/[^/]+\/\d{4}\/(\d{6,})\//i)?.[1];
    const fromKeys =
      raw.match(/[?&](?:imageKeys?|partitionKey)=(\d{6,})/i)?.[1] ||
      raw.match(/imageKeys=(\d{6,})(?:%7E|~)SID/i)?.[1];
    const stock = fromPath || fromKeys;
    if (!stock) continue;
    // Ignore Copart path lots — never treat as IAA stock.
    if (/\/copart\//i.test(raw) || /cs\.copart\.com/i.test(raw)) continue;
    counts.set(stock, (counts.get(stock) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [stock, n] of counts) {
    if (n > bestN) {
      best = stock;
      bestN = n;
    }
  }
  return best;
}

/**
 * Resolve the single IAA stock for spin attach.
 * Prefer the stock already present in the accepted gallery (fotorama CDN).
 * Import Motor `im-{lot}` is often a different number than IAA stock — do not
 * refuse a clean gallery just because those ids differ.
 */
export function resolveIaaiSpinStockId(opts: {
  html: string;
  galleryUrls: Array<string | null | undefined>;
  sourceId?: string | null;
}): string | undefined {
  const fromGallery = extractIaaiStockFromUrls(opts.galleryUrls);
  const fromSource = opts.sourceId?.replace(/^im-/i, "");
  const sourceStock = fromSource && /^\d{6,}$/.test(fromSource) ? fromSource : undefined;
  const fromHtml = extractIaaiSpinStockId(opts.html);

  if (fromGallery) return fromGallery;
  // No gallery CDN stock: only use HTML/source when they agree or HTML is absent.
  if (sourceStock && fromHtml && sourceStock !== fromHtml) {
    return htmlHasIaaiSpinForStock(opts.html, sourceStock) ? sourceStock : undefined;
  }
  return sourceStock || fromHtml;
}

/** True when the listing HTML embeds a real IAA 360 viewer for this stock (not just a lot path). */
export function htmlHasIaaiSpinForStock(html: string, stockId: string): boolean {
  if (!stockId || !/^\d{6,}$/.test(stockId)) return false;
  const id = stockId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    String.raw`ThreeSixtyView[^"'\s<>]*SID-${id}|keys=SID-${id}(?:~|%7E)|partitionKey=${id}(?:&|"|'|\s|$)|imageKeys=${id}(?:%7E|~)SID(?:%7E|~)(?:STP|INT)`,
    "i",
  ).test(html);
}

/** IAA stock id embedded in a spin/gallery URL, if any. */
export function iaaiStockIdFromPhotoUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const pk = u.searchParams.get("partitionKey");
    if (pk && /^\d{6,}$/.test(pk)) return pk;
    const keys = u.searchParams.get("imageKeys") || u.searchParams.get("imageKey") || "";
    const m = decodeURIComponent(keys).match(/^(\d{6,})(?:~|%7E)SID/i);
    if (m?.[1]) return m[1];
  } catch {
    /* ignore */
  }
  return url.match(/\/iaai\/[^/]+\/[^/]+\/\d{4}\/(\d{6,})\//i)?.[1];
}

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(6_000),
      headers: { "User-Agent": UA },
    });
    if (res.ok) return true;
    if (res.status !== 405 && res.status !== 501) return false;
    const get = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(6_000),
      headers: { "User-Agent": UA, Range: "bytes=0-64" },
    });
    return get.ok;
  } catch {
    return false;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function probeContiguous(makeUrl: (i: number) => string, max = IAAI_SPIN_MAX): Promise<string[]> {
  const first = makeUrl(1);
  if (!(await headOk(first))) return [];
  const urls = [first];
  for (let start = 2; start <= max; start += 8) {
    const chunk = await Promise.all(
      Array.from({ length: 8 }, (_, k) => {
        const i = start + k;
        if (i > max) return Promise.resolve({ i, ok: false as const, url: "" });
        const url = makeUrl(i);
        return headOk(url).then((ok) => ({ i, ok, url }));
      }),
    );
    chunk.sort((a, b) => a.i - b.i);
    let stop = false;
    for (const item of chunk) {
      if (!item.ok) {
        stop = true;
        break;
      }
      urls.push(item.url);
    }
    if (stop) break;
  }
  return urls;
}

/**
 * Probe contiguous STP/INT spin frames for an IAAI stock.
 * Exterior prefers the native 360 retriever (swipe sequence); interior uses INT stills.
 * Never mix retriever + STP exterior frames for the same stock (breaks sort order / UI).
 */
export async function expandIaaiSpinPhotos(stockId: string): Promise<NormalizedPhoto[]> {
  const out: NormalizedPhoto[] = [];

  const firstExt = iaaiExterior360Url(stockId, 1);
  const hasRetriever = await headOk(firstExt);

  if (hasRetriever) {
    const viewer = await fetchText(
      `https://vis.iaai.com/Home/ThreeSixtyView?keys=SID-${stockId}~STP-1~INT-1&iframeview=true`,
    );
    const amount = Number(viewer?.match(/data-amount-x=["'](\d+)["']/i)?.[1] || 0);
    const count =
      amount >= 4 && amount <= IAAI_SPIN_MAX
        ? amount
        : (await probeContiguous((i) => iaaiExterior360Url(stockId, i))).length;
    const n = count > 0 ? count : 1;
    for (let i = 1; i <= n; i++) {
      out.push({
        sourceUrl: iaaiExterior360Url(stockId, i),
        isPrimary: false,
        sortOrder: i - 1,
        group: "exterior_3d",
      });
    }
  } else {
    const stp = await probeContiguous((i) => iaaiSpinFrameUrl(stockId, "STP", i));
    stp.forEach((sourceUrl, sortOrder) => {
      out.push({ sourceUrl, isPrimary: false, sortOrder, group: "exterior_3d" });
    });
  }

  const intStills = await probeContiguous((i) => iaaiSpinFrameUrl(stockId, "INT", i));
  if (intStills.length) {
    intStills.forEach((sourceUrl, sortOrder) => {
      out.push({ sourceUrl, isPrimary: false, sortOrder, group: "interior_3d" });
    });
  } else {
    const pano = iaaiInteriorPanoUrl(stockId);
    if (await headOk(pano)) {
      out.push({ sourceUrl: pano, isPrimary: false, sortOrder: 0, group: "interior_3d" });
    }
  }

  return out;
}

/** Pull S0 still prefixes from HTML / already-parsed resizer URLs. */
export function extractIaaiS0Prefixes(html: string, urls: string[] = []): string[] {
  const prefixes = new Set<string>();
  const consider = (raw: string) => {
    const key = decodeURIComponent(raw.replace(/&amp;/g, "&")).replace(/~RW\d+~H\d+~TH\d+$/i, "");
    const m = key.match(/^(\d{6,}~SID(?:~B\d+)?~S0)(?:~I\d+)?/i);
    if (m?.[1]) prefixes.add(m[1]);
  };
  for (const u of urls) {
    try {
      const parsed = new URL(u);
      const keys = parsed.searchParams.get("imageKeys") || parsed.searchParams.get("imageKey");
      if (keys) consider(keys);
    } catch {
      /* ignore */
    }
  }
  for (const m of html.matchAll(/imageKey(?:s)?=([^"'&\s<>]+)/gi)) {
    consider(m[1]!);
  }
  return [...prefixes];
}

/**
 * Probe contiguous IAAI S0 gallery stills for prefixes discovered on the page.
 * Fills gaps when Fotorama only hydrated a sparse subset of deepzoom frames.
 */
export async function expandIaaiS0StillPhotos(
  prefixes: string[],
  max = 40,
): Promise<NormalizedPhoto[]> {
  const best = new Map<string, string>();
  for (const prefix of prefixes) {
    const makeUrl = (i: number) =>
      `${IAAI_VIS_RESIZER}?imageKeys=${prefix}~I${i}&width=845&height=633`;
    const zero = makeUrl(0);
    if (await headOk(zero)) best.set(photoKey(zero), zero);
    const contiguous = await probeContiguous((i) => makeUrl(i), max);
    for (const url of contiguous) best.set(photoKey(url), url);
  }

  const ordered = [...best.values()].sort((a, b) => {
    const na = Number(a.match(/~I(\d+)/i)?.[1] ?? 999);
    const nb = Number(b.match(/~I(\d+)/i)?.[1] ?? 999);
    return na - nb;
  });

  return ordered.map((sourceUrl, sortOrder) => ({
    sourceUrl,
    isPrimary: sortOrder === 0,
    sortOrder,
    group: "gallery" as const,
  }));
}

function photoKey(url: string): string {
  try {
    const keys = new URL(url).searchParams.get("imageKeys") || url;
    return keys.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
