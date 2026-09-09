/**
 * JapaneseCarTrade.com (JCT) — Japan used-car export portal (~250k stock).
 * List by make shards; detail LD+JSON + specs; gallery via action.php ___ShowOtherImages.
 * Identity: ISO VIN when present, else JP chassis (masked / serial-only skipped).
 */
import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  PaginationInfo,
} from "@workspace/providers";
import { JAPAN } from "../geo";
import {
  findVinInListing,
  normalizeJpChassis,
  parseYear,
  resolveHistoryVehicleId,
  vehicleFromParts,
} from "./kr-common";
import { moneyListing } from "./us-common";
import {
  asPhotos,
  asRecord,
  fetchHtml,
  firstRegEvent,
  num,
  str,
} from "./web-html";

export const JAPANESECARTRADE_PARSER_VERSION = "japanesecartrade-v1.0.0";
const BASE = "https://www.japanesecartrade.com";
const AJAX = `${BASE}/action/action.php`;
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/** Popular make_ids from JCT ByMakes (covers nearly all stock). */
const SEED_MAKE_IDS = [
  1, 3, 2, 128, 23, 122, 4, 6, 5, 7, 29, 30, 26, 9, 45, 8, 61, 62, 40, 34, 286, 43, 404, 12, 157, 484,
  236, 16, 19, 21, 35, 39, 38, 264, 33, 139, 116, 10, 406, 232, 119, 238, 140, 146, 28, 795, 22, 1050,
  187, 197, 115, 179, 1132, 773, 56, 11, 224, 796, 820, 615, 799, 464, 918, 47, 622, 181, 862, 601,
  172, 978, 1021, 114, 235, 458, 983, 614, 120, 55, 320, 497, 866, 1039,
];

const JCT_HEADERS = {
  "User-Agent": MOBILE_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${BASE}/`,
};

function isCfChallenge(html: string, status?: number): boolean {
  if (status === 403 || status === 503) return true;
  return /just a moment|cf-challenge|attention required|challenge-platform|security verification/i.test(
    html.slice(0, 8_000),
  );
}

function cdpEndpoint(): string | undefined {
  return (
    process.env.JCT_CDP_URL?.trim() ||
    process.env.IMPORT_MOTOR_CDP_URL?.trim() ||
    process.env.AUTOPLAC_CDP_URL?.trim() ||
    undefined
  );
}

async function fetchHtmlViaCdp(url: string): Promise<{ text: string; status: number; finalUrl: string }> {
  const endpoint = cdpEndpoint();
  if (!endpoint) {
    throw new Error(
      `JapaneseCarTrade Cloudflare challenge on ${url} — set JCT_CDP_URL or IMPORT_MOTOR_CDP_URL (Chrome --remote-debugging-port=9222)`,
    );
  }
  const base = endpoint.replace(/\/$/, "");
  const page = (await (
    await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })
  ).json()) as { id?: string; webSocketDebuggerUrl?: string };
  if (!page.webSocketDebuggerUrl || !page.id) {
    throw new Error(`JapaneseCarTrade CDP could not open a tab for ${url}`);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("JapaneseCarTrade CDP websocket connect timed out")), 15_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("JapaneseCarTrade CDP websocket failed"));
    });
  });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
    if (msg.id == null) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"));
    else p.resolve(msg.result);
  });

  const send = <T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 60_000): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`JapaneseCarTrade CDP ${method} timed out`));
        }
      }, timeoutMs);
    });

  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.navigate", { url });
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 800));
      const titleRes = await send<{ result?: { value?: string } }>("Runtime.evaluate", {
        expression: "document.title",
        returnByValue: true,
      });
      const title = titleRes.result?.value ?? "";
      if (title && !/just a moment|attention required|security verification/i.test(title)) break;
      if (i === 44) throw new Error(`JapaneseCarTrade CDP stuck on Cloudflare for ${url}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
    const htmlRes = await send<{ result?: { value?: string } }>("Runtime.evaluate", {
      expression: "document.documentElement.outerHTML",
      returnByValue: true,
    });
    const hrefRes = await send<{ result?: { value?: string } }>("Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    });
    const text = htmlRes.result?.value ?? "";
    if (!text || isCfChallenge(text)) {
      throw new Error(`JapaneseCarTrade CDP returned Cloudflare challenge for ${url}`);
    }
    return { text, status: 200, finalUrl: hrefRes.result?.value ?? url };
  } finally {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    try {
      await fetch(`${base}/json/close/${page.id}`);
    } catch {
      /* ignore */
    }
  }
}

async function jctFetchHtml(url: string): Promise<{ text: string; status: number; finalUrl: string }> {
  const fetched = await fetchHtml(url, JCT_HEADERS);
  if (!isCfChallenge(fetched.text, fetched.status) && fetched.status < 400) return fetched;
  return fetchHtmlViaCdp(url);
}

async function fetchGalleryHtml(stockNo: string, title: string): Promise<string> {
  const body = new URLSearchParams({
    action: "___ShowOtherImages",
    stock_no: stockNo,
    img_limit: "0",
    is_copied: "1",
    v_title: title.slice(0, 120),
  });
  try {
    const res = await fetch(AJAX, {
      method: "POST",
      headers: {
        ...JCT_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: BASE,
        Referer: `${BASE}/`,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!isCfChallenge(text, res.status) && res.status < 400 && text.length > 40) return text;
  } catch {
    /* fall through */
  }
  if (!cdpEndpoint()) return "";
  const endpoint = cdpEndpoint()!.replace(/\/$/, "");
  const page = (await (
    await fetch(`${endpoint}/json/new?${encodeURIComponent(`${BASE}/`)}`, { method: "PUT" })
  ).json()) as { id?: string; webSocketDebuggerUrl?: string };
  if (!page.webSocketDebuggerUrl || !page.id) return "";
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("gallery cdp ws")), 15_000);
      ws.addEventListener("open", () => {
        clearTimeout(t);
        resolve();
      });
      ws.addEventListener("error", () => reject(new Error("gallery cdp err")));
    });
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message?: string } };
      if (msg.id == null) return;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "cdp"));
      else p.resolve(msg.result);
    });
    const send = <T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve: (v) => resolve(v as T), reject });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error("gallery cdp timeout"));
          }
        }, 45_000);
      });
    await send("Runtime.enable");
    const expr = `(async()=>{const r=await fetch(${JSON.stringify(AJAX)},{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:${JSON.stringify(body.toString())}});return await r.text();})()`;
    const res = await send<{ result?: { value?: string } }>("Runtime.evaluate", {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    });
    return res.result?.value ?? "";
  } catch {
    return "";
  } finally {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    try {
      await fetch(`${endpoint}/json/close/${page.id}`);
    } catch {
      /* ignore */
    }
  }
}

export function japanesecartradeDetailUrl(idOrUrl: string): string {
  const raw = idOrUrl.trim();
  if (raw.startsWith("http")) return raw.split("?")[0]!;
  if (raw.startsWith("/")) return `${BASE}${raw.split("?")[0]}`;
  if (/^\d+$/.test(raw)) return `${BASE}/${raw}-japan-used-car.html`;
  return `${BASE}/${raw.replace(/^\//, "")}`;
}

function stockIdFromUrl(url: string): string | undefined {
  return url.match(/\/(\d{6,})-japan-used-/i)?.[1] ?? url.match(/JCT-(\d{6,})/i)?.[1];
}

function parseMakeIds(html: string): number[] {
  const ids = new Set<number>();
  for (const m of html.matchAll(/used-vehicles-(\d+)\.html/gi)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }
  for (const m of html.matchAll(/\bid=["']M(\d+)["']/gi)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }
  for (const m of html.matchAll(/make_id=(\d+)/gi)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }
  return [...ids].sort((a, b) => a - b);
}

function collectJctPhotos(...parts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw?: string) => {
    if (!raw) return;
    let url = raw.startsWith("//") ? `https:${raw}` : raw;
    url = url.split("?")[0]!;
    if (!/^https?:\/\//i.test(url)) return;
    if (/logo|sprite|favicon|loading|flag-big|app_download|placeholder|nophoto/i.test(url)) return;
    if (!/vehicle_image|\/jct\/vehicle_image\//i.test(url) && !/\/vehicle_image\//i.test(url)) return;
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(url);
  };
  for (const part of parts) {
    for (const m of part.matchAll(/https?:\/\/[^"'\\\s>]+\.(?:jpe?g|webp|png)/gi)) {
      push(m[0]);
    }
    for (const m of part.matchAll(/src=["']([^"']+)["']/gi)) {
      push(m[1]);
    }
    for (const m of part.matchAll(/href=["'](https?:\/\/[^"']+\.(?:jpe?g|webp|png))["']/gi)) {
      push(m[1]);
    }
  }
  return out;
}

function parseLdCar(html: string): Record<string, unknown> | undefined {
  for (const block of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(block[1]!);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const rec = asRecord(node);
        if (!rec) continue;
        const type = String(rec["@type"] ?? "");
        if (/car|vehicle|product/i.test(type) || rec.vehicleIdentificationNumber || rec.mileageFromOdometer) {
          return rec;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function specValue(html: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<li[^>]*>\\s*<span[^>]*>\\s*${escaped}\\s*</span>\\s*<strong[^>]*>([\\s\\S]*?)</strong>`,
    "i",
  );
  const m = html.match(re);
  if (!m?.[1]) return undefined;
  return m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractChassis(html: string, ld?: Record<string, unknown>): string | undefined {
  const labeled =
    str(ld?.vehicleIdentificationNumber) ??
    specValue(html, "Chassis Number") ??
    html.match(/Chassis No\.?:\s*([A-Z0-9*-]+)/i)?.[1] ??
    html.match(/dcard_col_chassis[^>]*>Chassis No\.?:\s*([A-Z0-9*-]+)/i)?.[1];
  return resolveHistoryVehicleId(labeled) ?? findVinInListing(html, labeled);
}

let cachedMakeIds: number[] | null = null;

export class JapanesecartradeHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "japanesecartrade";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  private makeIds(): number[] {
    const fromFilter = this._filters.makeIds ?? this._filters.make_ids;
    if (Array.isArray(fromFilter) && fromFilter.length) {
      return fromFilter.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    }
    return cachedMakeIds?.length ? cachedMakeIds : SEED_MAKE_IDS;
  }

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const makes = this.makeIds();
    const makeId = makes[(page - 1) % makes.length]!;
    const makePage = Math.floor((page - 1) / makes.length) + 1;
    const listUrl = `${BASE}/stock_list.php?SA=make&make_id=${makeId}&page=${makePage}`;
    const fetched = await jctFetchHtml(listUrl);

    const discovered = parseMakeIds(fetched.text);
    if (discovered.length >= 20) cachedMakeIds = discovered;

    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const match of fetched.text.matchAll(
      /href=["']((?:https?:\/\/(?:www\.)?japanesecartrade\.com)?\/?(\d{6,})-japan-used-[^"'?#]+\.html)["']/gi,
    )) {
      const raw = match[1]!;
      const id = match[2]!;
      if (seen.has(id)) continue;
      seen.add(id);
      const url = raw.startsWith("http") ? raw.split("?")[0]! : `${BASE}/${raw.replace(/^\//, "").split("?")[0]}`;
      const chassisRaw = fetched.text.match(
        new RegExp(`${id}[\\s\\S]{0,1200}?Chassis No\\.?:\\s*([A-Z0-9*-]+)`, "i"),
      )?.[1];
      const chassis = resolveHistoryVehicleId(chassisRaw) ?? normalizeJpChassis(chassisRaw);
      listings.push({
        sourceId: id,
        url,
        metadata: chassis ? { vin: chassis, chassis } : undefined,
      });
    }

    const total = num(fetched.text.match(/class=["']ttlNowRecords["'][^>]*>([\d,]+)/i)?.[1]);
    const maxPage = total ? Math.max(1, Math.ceil(total / 20)) : makePage;
    const hasMore = listings.length >= 8 || makePage < Math.max(maxPage, 6000);

    return { listings, pagination: { currentPage: page, hasMore } };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const detailUrl = japanesecartradeDetailUrl(url);
    const fetched = await jctFetchHtml(detailUrl);
    const stockNo = stockIdFromUrl(fetched.finalUrl) ?? stockIdFromUrl(detailUrl) ?? "0";
    const title =
      fetched.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? stockNo;
    const galleryHtml = await fetchGalleryHtml(stockNo, title);
    return {
      url: fetched.finalUrl,
      html: fetched.text,
      json: galleryHtml ? { galleryHtml } : undefined,
      statusCode: fetched.status,
      headers: {},
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const ld = parseLdCar(html);
    const sourceId =
      stockIdFromUrl(fetched.url) ??
      specValue(html, "JCT Ref. ID")?.replace(/^JCT-/i, "") ??
      "unknown";

    const metaVin =
      typeof fetched.metadata === "object" ? str(asRecord(fetched.metadata)?.vin) : undefined;
    const vin =
      extractChassis(html, ld) ??
      resolveHistoryVehicleId(metaVin) ??
      findVinInListing(html);

    const brand = asRecord(ld?.brand);
    const make =
      str(brand?.name) ??
      specValue(html, "Make") ??
      html.match(/ShowAppBox\([^)]*'([^']+)',\s*'([^']+)',\s*'(\d{4})'/i)?.[1];
    const model = str(ld?.model) ?? specValue(html, "Model");
    const year =
      num(ld?.vehicleModelDate) ??
      parseYear(str(ld?.vehicleModelDate)) ??
      parseYear(specValue(html, "Reg. Year/Month")) ??
      parseYear(specValue(html, "Mfg. Year/Month"));

    const mileageObj = asRecord(ld?.mileageFromOdometer);
    const mileageRaw =
      num(mileageObj?.value) ??
      num(specValue(html, "Mileage")?.replace(/[^\d]/g, "")) ??
      num(html.match(/([\d,]+)\s*KM/i)?.[1]);
    const mileage = mileageRaw && mileageRaw > 0 ? mileageRaw : undefined;

    const offers = asRecord(ld?.offers);
    const price =
      num(offers?.price) ??
      num(html.match(/class=["']offer_price\d+["'][^>]*>([\d,]+)/i)?.[1]) ??
      num(html.match(/FOB\s*:?\s*([\d,]+)/i)?.[1]);

    const title =
      str(ld?.name) ??
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ??
      [year, make, model].filter(Boolean).join(" ");

    const galleryHtml = str(asRecord(fetched.json)?.galleryHtml) ?? "";
    const photoUrls = vin ? collectJctPhotos(html, galleryHtml) : [];
    const photos = asPhotos(photoUrls, 40);
    const firstReg = firstRegEvent(specValue(html, "Reg. Year/Month")) ?? firstRegEvent(year);

    const fuel = str(ld?.fuelType) ?? specValue(html, "Fuel");
    const transmission = str(ld?.vehicleTransmission) ?? specValue(html, "Transmission");
    const color = str(ld?.color) ?? specValue(html, "Exterior Color");
    const bodyType = str(ld?.bodyType) ?? specValue(html, "Type");

    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title,
      price,
      currency: "USD",
      mileage,
      mileageUnit: "km",
      location: JAPAN,
      country: JAPAN,
      vehicle: vehicleFromParts({
        vin,
        make,
        model,
        year,
        fuelType: fuel,
        transmission,
        color,
        bodyType,
        country: JAPAN,
      }),
      photos,
      events: firstReg ? [firstReg] : undefined,
    });
  }
}
