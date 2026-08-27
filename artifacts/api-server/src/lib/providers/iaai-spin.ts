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

/** Extract IAAI stock id from ThreeSixty iframe / keys on listing HTML. */
export function extractIaaiSpinStockId(html: string, lot?: string): string | undefined {
  const fromIframe =
    html.match(/vis\.iaai\.com\/Home\/ThreeSixtyView\?[^"'>\s]*keys=SID-(\d+)/i)?.[1] ||
    html.match(/ThreeSixtyView[^"'>\s]*SID-(\d+)/i)?.[1] ||
    html.match(/keys=SID-(\d+)~STP/i)?.[1] ||
    html.match(/mediaretriever\.iaai\.com\/api\/ThreeSixtyImageRetriever[^"'>\s]*partitionKey=(\d+)/i)?.[1];
  if (fromIframe) return fromIframe;
  if (lot && /^\d{6,}$/.test(lot) && /images\/360\.png|in 360 degrees|ThreeSixtyView/i.test(html)) {
    return lot;
  }
  return undefined;
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
