/**
 * BE FORWARD (beforward.jp) — Japan used-car export marketplace.
 * Make-sharded stocklist; Chassis No. (ISO VIN or JP frame); USD FOB; image-cdn gallery.
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
  parseYear,
  resolveHistoryVehicleId,
  vehicleFromParts,
} from "./kr-common";
import { extraSpecEvent } from "./title-enrichment";
import { moneyListing } from "./us-common";
import { asPhotos, fetchHtml, firstRegEvent, num, str } from "./web-html";

export const BEFORWARD_PARSER_VERSION = "beforward-v1.0.1";
const BASE = "https://www.beforward.jp";

/** Popular make= ids from stocklist nav (refreshed from live HTML when possible). */
const SEED_MAKE_IDS = [
  1, 3, 2, 4, 5, 94, 7, 8, 10, 103, 68, 106, 83, 48, 47, 73, 50, 57, 52, 79, 306, 11, 12, 13, 14, 15, 16,
  17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41,
  42, 43, 44, 45, 46, 49, 51, 53, 54, 55, 56, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 69, 70, 71, 72,
  74, 75, 76, 77, 78, 80, 81, 82, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 95, 96, 97, 98, 99, 100,
];

let cachedMakeIds: number[] | null = null;

const BF_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${BASE}/`,
};

function cdpEndpoint(): string | undefined {
  return (
    process.env.BEFORWARD_CDP_URL?.trim() ||
    process.env.JCT_CDP_URL?.trim() ||
    process.env.IMPORT_MOTOR_CDP_URL?.trim() ||
    process.env.AUTOPLAC_CDP_URL?.trim() ||
    undefined
  );
}

async function bfFetchViaCdp(url: string): Promise<{ text: string; status: number; finalUrl: string }> {
  const endpoint = cdpEndpoint();
  if (!endpoint) throw new Error("No CDP endpoint for BE FORWARD");
  const base = endpoint.replace(/\/$/, "");
  const page = (await (
    await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })
  ).json()) as { id?: string; webSocketDebuggerUrl?: string };
  if (!page.webSocketDebuggerUrl || !page.id) {
    throw new Error(`BE FORWARD CDP could not open tab for ${url}`);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("BE FORWARD CDP connect timeout")), 15_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("BE FORWARD CDP websocket failed"));
    });
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message?: string } };
    if (msg.id == null) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"));
    else p.resolve(msg.result);
  });
  const send = <T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 30_000) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} timeout`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  try {
    await send("Page.enable");
    await send("Page.navigate", { url });
    // Wait for body text.
    let html = "";
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const evalResult = await send<{ result?: { value?: string } }>("Runtime.evaluate", {
        expression: "document.documentElement.outerHTML",
        returnByValue: true,
      });
      html = evalResult.result?.value ?? "";
      if (html.length > 5000 && !/just a moment|cf-challenge/i.test(html.slice(0, 2000))) break;
    }
    const final = await send<{ result?: { value?: string } }>("Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    });
    return { text: html, status: html.length > 500 ? 200 : 429, finalUrl: final.result?.value ?? url };
  } finally {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    try {
      await fetch(`${base}/json/close/${page.id}`, { method: "PUT" });
    } catch {
      /* ignore */
    }
  }
}

async function bfFetch(url: string): Promise<{ text: string; status: number; finalUrl: string }> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const fetched = await fetchHtml(url, BF_HEADERS);
    lastStatus = fetched.status;
    if (fetched.status === 200 && fetched.text.length >= 500) return fetched;
    if (fetched.status === 429 || fetched.status === 503 || fetched.text.length < 500) {
      const wait = Math.min(45_000, 3_000 * 2 ** attempt + Math.floor(Math.random() * 1500));
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (fetched.status >= 400) {
      throw new Error(`BE FORWARD HTTP ${fetched.status} for ${url}`);
    }
  }
  if (cdpEndpoint()) {
    try {
      const via = await bfFetchViaCdp(url);
      if (via.text.length >= 500) return via;
    } catch {
      /* fall through */
    }
  }
  throw new Error(`BE FORWARD rate-limited (HTTP ${lastStatus}) for ${url}`);
}

export function beforwardDetailUrl(idOrUrl: string): string {
  const raw = String(idOrUrl ?? "").trim();
  if (!raw) return BASE;
  if (/^https?:\/\//i.test(raw)) return raw.split("#")[0]!.split("?")[0]!;
  if (raw.startsWith("/")) return `${BASE}${raw.split("?")[0]}`;
  if (/^\d{5,}$/.test(raw)) return `${BASE}/vehicle/${raw}`;
  return `${BASE}/${raw.replace(/^\//, "")}`;
}

function stockIdFromUrl(url: string): string | undefined {
  const m =
    url.match(/\/id\/(\d+)\//i) ??
    url.match(/\/vehicle\/(\d+)/i) ??
    url.match(/stock_id=(\d+)/i);
  return m?.[1];
}

function parseMakeIds(html: string): number[] {
  const ids = [...html.matchAll(/stocklist\/make=(\d+)/gi)].map((m) => Number(m[1]));
  return [...new Set(ids)].filter((n) => Number.isFinite(n) && n > 0);
}

const SPEC_HEADER_NOISE =
  /^(year|month|engine|trans\.?|fuel|color|drive|body|type|mileage|chassis|model|steering|doors|seats|mission|mfg|price|make)$/i;

function cleanSpecVal(raw?: string): string | undefined {
  const val = raw?.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  if (!val || val.length >= 64) return undefined;
  if (/menu|strike|option|href|script|specs-pickup/i.test(val)) return undefined;
  if (SPEC_HEADER_NOISE.test(val)) return undefined;
  if (val === "-" || val === "—") return undefined;
  return val;
}

/** Prefer real `<th>Label</th><td>value</td>` cells; skip stocklist header rows. */
function specValue(html: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    // Registration Year/month spans two lines inside <th>.
    new RegExp(
      `<th[^>]*>\\s*(?:<[^>]+>\\s*)*${escaped}[\\s\\S]{0,80}?<\\/th>\\s*<td[^>]*>\\s*([^<]{1,80})`,
      "i",
    ),
    new RegExp(`${escaped}\\s*</th>\\s*<td[^>]*>\\s*([^<]{1,80})`, "i"),
    new RegExp(
      `${escaped}\\s*</[^>]+>\\s*<[^>]+>\\s*([^<]{1,80})`,
      "i",
    ),
    new RegExp(
      `>(?:\\s|&nbsp;)*${escaped}(?:\\s|&nbsp;)*<\\/[^>]+>[\\s\\S]{0,120}?>([^<]{1,80})<`,
      "i",
    ),
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
      const val = cleanSpecVal(m[1]);
      if (val) return val;
    }
  }
  return undefined;
}

function hiddenAttr(html: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\s*=\\s*["']([^"']+)["']`, "i");
  return cleanSpecVal(html.match(re)?.[1]);
}

function positiveNum(value: unknown): number | undefined {
  const n = num(value);
  return n != null && n > 0 ? n : undefined;
}

function parseLdCar(html: string): Record<string, unknown> | undefined {
  for (const block of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsed = JSON.parse(block[1]!);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const rec = node as Record<string, unknown>;
        const type = String(rec["@type"] ?? "");
        if (/car|vehicle|product/i.test(type) || rec.vehicleIdentificationNumber) return rec;
      }
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/**
 * Gallery only for this stock id. Prefer `original`, then `large`.
 * Preserve first-seen file order (site gallery order).
 */
export function collectBeforwardPhotos(html: string, stockId: string, max = 60): string[] {
  if (!/^\d{5,}$/.test(stockId)) return [];
  const sizeRank: Record<string, number> = { original: 4, large: 3, medium: 2, small: 1 };
  const byFile = new Map<string, { url: string; rank: number; order: number }>();
  let order = 0;
  const re = new RegExp(
    `(?:https?:)?\\/\\/image-cdn\\.beforward\\.jp\\/(original|large|medium|small)\\/(\\d+)\\/${stockId}\\/([^"'?\\s>]+)`,
    "gi",
  );
  for (const match of html.matchAll(re)) {
    const size = match[1]!.toLowerCase();
    const yyyymm = match[2]!;
    const file = match[3]!;
    const key = file.toLowerCase();
    const rank = sizeRank[size] ?? 0;
    const url = `https://image-cdn.beforward.jp/${size}/${yyyymm}/${stockId}/${file}`;
    const prev = byFile.get(key);
    if (!prev) {
      byFile.set(key, { url, rank, order: order++ });
    } else if (rank > prev.rank) {
      byFile.set(key, { url, rank, order: prev.order });
    }
  }
  return [...byFile.values()]
    .sort((a, b) => a.order - b.order)
    .slice(0, max)
    .map((row) => row.url);
}

function extractChassis(html: string): string | undefined {
  const labeled =
    specValue(html, "Chassis No.") ??
    specValue(html, "Chassis No") ??
    html.match(/Chassis No\.?\s*<\/[^>]+>\s*<[^>]+>([^<]+)/i)?.[1]?.trim() ??
    html.match(/Chassis No\.?\s*[:：]\s*([A-HJ-NPR-Z0-9*-]{8,24})/i)?.[1];
  if (!labeled || /\*|X{3,}/i.test(labeled)) return undefined;
  return (
    resolveHistoryVehicleId(labeled) ??
    findVinInListing(html, labeled) ??
    undefined
  );
}

function cleanFuel(raw?: string): string | undefined {
  const t = raw?.replace(/\s+/g, " ").trim();
  if (!t || t.length > 40) return undefined;
  if (/efficient|vehicles|menu|sortkey/i.test(t)) return undefined;
  return t;
}

function cleanTransmission(raw?: string): string | undefined {
  const t = raw?.replace(/\s+/g, " ").trim();
  if (!t || t.length > 40) return undefined;
  if (/drivetrain|components|menu|search/i.test(t)) return undefined;
  return t;
}

export class BeforwardHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "beforward";
  constructor(
    private _baseUrl?: string,
    private _filters: Record<string, unknown> = {},
  ) {}

  private makeIds(): number[] {
    const fromFilter = this._filters.makeIds ?? this._filters.make_ids;
    if (Array.isArray(fromFilter) && fromFilter.length) {
      return fromFilter.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    }
    return cachedMakeIds?.length ? cachedMakeIds : SEED_MAKE_IDS;
  }

  async discoverListings(
    page: number,
  ): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const makes = this.makeIds();
    const makeId = makes[(Math.max(1, page) - 1) % makes.length]!;
    const makePage = Math.floor((Math.max(1, page) - 1) / makes.length) + 1;
    const listUrl =
      makePage <= 1
        ? `${BASE}/stocklist/make=${makeId}/`
        : `${BASE}/stocklist/make=${makeId}/page=${makePage}/`;
    const fetched = await bfFetch(listUrl);

    const discovered = parseMakeIds(fetched.text);
    if (discovered.length >= 15) cachedMakeIds = discovered;

    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const match of fetched.text.matchAll(
      /href="((?:https:\/\/www\.beforward\.jp)?\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/id\/(\d+)\/)"/gi,
    )) {
      const pathOrUrl = match[1]!;
      const id = match[2]!;
      if (seen.has(id)) continue;
      seen.add(id);
      const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE}${pathOrUrl}`;
      listings.push({ sourceId: id, url });
    }

    const hasMore = listings.length >= 8 || makePage < 500;
    return { listings, pagination: { currentPage: page, hasMore } };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const detailUrl = beforwardDetailUrl(url);
    const fetched = await bfFetch(detailUrl);
    return {
      url: fetched.finalUrl,
      html: fetched.text,
      statusCode: fetched.status,
      headers: {},
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const sourceId =
      stockIdFromUrl(fetched.url) ??
      stockIdFromUrl(String((fetched as { sourceId?: string }).sourceId ?? "")) ??
      "unknown";
    const ld = parseLdCar(html) ?? {};
    const brand = ld.brand && typeof ld.brand === "object" ? (ld.brand as Record<string, unknown>) : null;

    const vin = extractChassis(html);
    const title =
      str(ld.name) ??
      html
        .match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
        ?.replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const pathParts = fetched.url.replace(/^https?:\/\/[^/]+/i, "").split("/").filter(Boolean);
    const makeFromPath = pathParts[0]?.replace(/-/g, " ");
    const modelFromPath = pathParts[1]?.replace(/-/g, " ");

    const regYm =
      cleanSpecVal(
        html.match(
          /Registration[\s\S]{0,80}?Year\s*\/\s*month[\s\S]{0,60}?<td[^>]*>\s*([^<]+)/i,
        )?.[1],
      ) ??
      cleanSpecVal(html.match(/>(\d{4})\s*\/\s*(\d{1,2})</)?.[0]?.replace(/^>/, ""));
    const yearRaw =
      (regYm && /^\d{4}/.test(regYm) ? regYm : undefined) ??
      hiddenAttr(html, "spec_reg_year") ??
      title?.match(/\b((?:19|20)\d{2})\b/)?.[1];
    const year = parseYear(yearRaw) ?? parseYear(title);

    const mileage =
      positiveNum(hiddenAttr(html, "mileage")) ??
      positiveNum(specValue(html, "Mileage")?.replace(/[^\d]/g, "")) ??
      positiveNum(html.match(/([\d,]+)\s*km/i)?.[1]);

    const offers = ld.offers && typeof ld.offers === "object" ? (ld.offers as Record<string, unknown>) : null;
    const price =
      positiveNum(offers?.price) ??
      positiveNum(hiddenAttr(html, "price")) ??
      positiveNum(html.match(/"price"\s*:\s*"(\d+)"/i)?.[1]) ??
      positiveNum(html.match(/USD\s*([\d,]+)/i)?.[1]);

    const fuelType = cleanFuel(
      specValue(html, "Fuel") ?? hiddenAttr(html, "fuel") ?? str(ld.fuelType),
    );
    const transmission = cleanTransmission(
      specValue(html, "Transmission") ??
        specValue(html, "Trans.") ??
        hiddenAttr(html, "mission") ??
        str(ld.vehicleTransmission),
    );
    const engine =
      specValue(html, "Engine") ??
      hiddenAttr(html, "engine") ??
      html.match(/([\d,]+)\s*cc/i)?.[0] ??
      str(ld.vehicleEngine);
    const color = specValue(html, "Color") ?? specValue(html, "Ext. Color") ?? str(ld.color);
    const driveType = specValue(html, "Drive") ?? specValue(html, "Drivetrain");
    const steering = specValue(html, "Steering");
    const bodyType = specValue(html, "Body") ?? specValue(html, "Type") ?? str(ld.bodyType);

    const make =
      str(brand?.name) ??
      (makeFromPath ? makeFromPath.replace(/\b\w/g, (c) => c.toUpperCase()) : undefined);
    const model =
      modelFromPath?.replace(/\b\w/g, (c) => c.toUpperCase()) ??
      specValue(html, "Model") ??
      str(ld.model);

    const photos = vin ? asPhotos(collectBeforwardPhotos(html, sourceId), 40) : [];
    const firstReg =
      firstRegEvent(regYm) ??
      firstRegEvent(yearRaw) ??
      firstRegEvent(year) ??
      firstRegEvent(html.match(/(\d{4})\s*\/\s*(\d{1,2})/)?.[0]);

    const events = [
      firstReg,
      extraSpecEvent("beforward", "steering", "Steering", steering),
      extraSpecEvent(
        "beforward",
        "model_code",
        "Model code",
        str(ld.sku) ?? specValue(html, "Model Code") ?? hiddenAttr(html, "model_code"),
      ),
      extraSpecEvent("beforward", "doors", "Doors", specValue(html, "Doors")),
      extraSpecEvent("beforward", "seats", "Seats", specValue(html, "Seats")),
    ].filter((e): e is NonNullable<typeof e> => Boolean(e));

    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title: title ?? [year, make, model].filter(Boolean).join(" "),
      price,
      currency: "USD",
      mileage: mileage,
      mileageUnit: "km",
      location: JAPAN,
      country: JAPAN,
      vehicle: vehicleFromParts({
        vin,
        year,
        make,
        model,
        fuelType,
        transmission,
        bodyType,
        driveType,
        engineDisplacement: engine?.replace(/\s+/g, " ").trim(),
        color,
        country: JAPAN,
      }),
      photos,
      events: events.length ? events : undefined,
    });
  }
}
