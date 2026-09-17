/**
 * Carstat.info — Korean insurance-auction history (VIN-only).
 *
 * Cloudflare blocks Node TLS; fetches use dedicated Chrome CDP tabs
 * (`IMPORT_MOTOR_CDP_URL` / `CARSTAT_CDP_URL`) — same browser as Import Motor,
 * but not the IM tab pool (avoids stale-page crosstalk).
 *
 * Catalog: /catalog + /catalog/page/{n} (~24 lots/page, newest first).
 * Detail:  /lot/{uuid}/{maker}/{vin?} — JSON-LD Vehicle + seller damage stamps.
 * Persist only lots that resolve to a real 17-char VIN after the detail page
 * (catalog often omits VIN on the card / URL even when the lot page has one).
 * Discover always includes catalog rows; the pipeline drops true no-VIN lots.
 */

import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  NormalizedVehicle,
  NormalizedPhoto,
  NormalizedEvent,
  PaginationInfo,
} from "@workspace/providers";
import { SOUTH_KOREA } from "../geo";
import { cleanEngineDisplacement } from "./title-enrichment";
import {
  normalizeKrVin,
  parseYear,
  vehicleFromParts,
  krwListing,
} from "./kr-common";
import { carstatCdpConfigured, carstatGetViaCdp } from "./carstat-cdp";
import { panelsFromCarstatMarks } from "../body-condition";

export const CARSTAT_PARSER_VERSION = "carstat-v1.3.0";
export const CARSTAT_WEB_BASE = "https://carstat.info";
const PAGE_SIZE = 24;
const MAX_PHOTOS = 40;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type CarstatFilterParams = {
  maxPages?: number;
  delayMs?: number;
  concurrency?: number;
  /** When true (default), discover only catalog rows with a VIN. */
  vinOnly?: boolean;
};

type CarstatLotCard = {
  id: string;
  number?: string | number | null;
  name?: string | null;
  model?: string | null;
  maker?: string | null;
  year?: number | null;
  fuel?: string | null;
  mileage?: number | null;
  capacity?: number | null;
  vin?: string | null;
  endTime?: string | null;
  createdAt?: string | null;
  details?: {
    nameEn?: string | null;
    damageClass?: string | null;
    damageZones?: string[] | null;
  } | null;
};

type CarstatLotPayload = {
  lotId: string;
  sourceUrl: string;
  vin?: string;
  title?: string;
  make?: string;
  model?: string;
  year?: number;
  fuelType?: string;
  mileageKm?: number;
  engineDisplacement?: string;
  lotNumber?: string;
  endAt?: Date;
  listedAt?: Date;
  damageClass?: string;
  damageZones?: string[];
  damageStamps?: string[];
  /** Human-facing badge labels (same stamps + class), for UI chips. */
  badges?: string[];
  airbagNote?: string;
  sellerNotes?: string[];
  color?: string;
  transmission?: string;
  driveType?: string;
  bodyType?: string;
  photos: string[];
  description?: string;
  catalog?: CarstatLotCard;
};

function isCfChallenge(html: string): boolean {
  return /just a moment|cf-challenge|attention required|challenge-platform/i.test(html.slice(0, 8_000));
}

export function carstatUsesCdp(): boolean {
  return carstatCdpConfigured();
}

async function csFetch(url: string): Promise<{ text: string; status: number; finalUrl: string }> {
  // Dedicated CDP tabs — do not reuse Import Motor pool tabs (stale-page risk).
  if (carstatUsesCdp()) {
    const r = await carstatGetViaCdp(url);
    if (isCfChallenge(r.text)) {
      throw new Error(`Carstat Cloudflare challenge via CDP on ${url}`);
    }
    return { text: r.text, status: r.status, finalUrl: r.url || url };
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  const text = await res.text();
  if (isCfChallenge(text) || res.status === 403) {
    throw new Error(
      `Carstat Cloudflare blocked Node fetch for ${url} — set IMPORT_MOTOR_CDP_URL or CARSTAT_CDP_URL (Chrome --remote-debugging-port=9222)`,
    );
  }
  return { text, status: res.status, finalUrl: res.url || url };
}

/** Parse Next.js flight `$D2026-09-28T06:30:00.000Z` / ISO dates. */
export function parseCarstatDate(raw?: string | null): Date | undefined {
  if (!raw) return undefined;
  const cleaned = String(raw).replace(/^\$D/, "").trim();
  if (!cleaned) return undefined;
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function carstatDetailUrl(lotIdOrPath: string, maker?: string, vin?: string): string {
  if (lotIdOrPath.startsWith("http")) return lotIdOrPath;
  const cleaned = lotIdOrPath.replace(/^\/+/, "");
  if (cleaned.startsWith("lot/")) return `${CARSTAT_WEB_BASE}/${cleaned}`;
  const uuid = cleaned.split("/")[0]!;
  const parts = ["lot", uuid];
  if (maker) parts.push(slugify(maker));
  if (vin) parts.push(vin.toUpperCase());
  return `${CARSTAT_WEB_BASE}/${parts.join("/")}`;
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function catalogPageUrl(page: number): string {
  if (page <= 1) return `${CARSTAT_WEB_BASE}/catalog`;
  return `${CARSTAT_WEB_BASE}/catalog/page/${page}`;
}

function unescapeNextPushes(html: string): string[] {
  const out: string[] = [];
  const re = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(`"${m[1]}"`));
    } catch {
      out.push(m[1]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
    }
  }
  return out;
}

function extractJsonArrayAfterMarker(blob: string, marker: string): unknown[] | undefined {
  const idx = blob.indexOf(marker);
  if (idx < 0) return undefined;
  let i = idx + marker.length;
  while (i < blob.length && blob[i] !== "[") i++;
  if (blob[i] !== "[") return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < blob.length; j++) {
    const c = blob[j]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(blob.slice(i, j + 1));
          return Array.isArray(parsed) ? parsed : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** Extract catalog `lots` array from Next.js RSC flight payload. */
export function extractCarstatCatalogLots(html: string): CarstatLotCard[] {
  for (const push of unescapeNextPushes(html)) {
    if (!push.includes('"lots":[')) continue;
    const arr = extractJsonArrayAfterMarker(push, '"lots":');
    if (!arr?.length) continue;
    const cards: CarstatLotCard[] = [];
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = String(r.id ?? "").trim();
      if (!/^[a-f0-9-]{36}$/i.test(id)) continue;
      const details =
        r.details && typeof r.details === "object"
          ? (r.details as CarstatLotCard["details"])
          : null;
      cards.push({
        id,
        number: (r.number as string | number | null | undefined) ?? null,
        name: (r.name as string) ?? null,
        model: (r.model as string) ?? null,
        maker: (r.maker as string) ?? null,
        year: typeof r.year === "number" ? r.year : Number(r.year) || null,
        fuel: (r.fuel as string) ?? null,
        mileage: typeof r.mileage === "number" ? r.mileage : Number(r.mileage) || null,
        capacity: typeof r.capacity === "number" ? r.capacity : Number(r.capacity) || null,
        vin: (r.vin as string) ?? null,
        endTime: (r.endTime as string) ?? null,
        createdAt: (r.createdAt as string) ?? null,
        details,
      });
    }
    if (cards.length) return cards;
  }
  return [];
}

/** Fallback: /lot/{uuid}/... hrefs when RSC payload is missing. */
export function extractCarstatLotHrefs(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of html.matchAll(/href="(\/lot\/[a-f0-9-]{36}[^"]*)"/gi)) {
    const href = m[1]!;
    const id = href.match(/\/lot\/([a-f0-9-]{36})/i)?.[1]?.toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(href);
  }
  return out;
}

/** High-water catalog size — deep pages only link nearby pages, so per-page max shrinks. */
let carstatCatalogMaxPage = 0;

export function extractCarstatMaxPage(html: string): number | undefined {
  let max = 0;
  for (const m of html.matchAll(/\/catalog\/page\/(\d+)/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  if (max > carstatCatalogMaxPage) carstatCatalogMaxPage = max;
  const effective = Math.max(max, carstatCatalogMaxPage);
  return effective > 0 ? effective : undefined;
}

/** Reset between tests; production crawls keep the high-water mark for the process. */
export function resetCarstatCatalogMaxPage(): void {
  carstatCatalogMaxPage = 0;
}

function mapFuel(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const t = raw.toLowerCase().trim();
  if (/electric|ev\b|전기/.test(t)) return "electric";
  if (/hybrid|hev|phev|하이브리드/.test(t)) return "hybrid";
  if (/diesel|디젤/.test(t)) return "diesel";
  if (/gas|petrol|gasoline|petrol|휘발유|가솔린/.test(t)) return "petrol";
  if (/lpg|수소|hydrogen/.test(t)) return t;
  return raw;
}

function titleCaseMake(maker?: string | null): string | undefined {
  if (!maker) return undefined;
  return maker
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((w) => (w.toLowerCase() === "bmw" || w.toLowerCase() === "mini" ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("-")
    .replace(/^Mercedes-Benz$/i, "Mercedes-Benz");
}

function modelDisplay(model?: string | null): string | undefined {
  if (!model) return undefined;
  return model
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^[a-z0-9]+$/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function vinFromHref(href: string): string | undefined {
  const tail = href.split("/").pop() || "";
  return normalizeKrVin(tail);
}

function lotIdFromHref(href: string): string | undefined {
  return href.match(/\/lot\/([a-f0-9-]{36})/i)?.[1]?.toLowerCase();
}

function extractJsonLdGraphs(html: string): Record<string, unknown>[] {
  const graphs: Record<string, unknown>[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1]!);
      if (parsed?.["@graph"] && Array.isArray(parsed["@graph"])) {
        for (const node of parsed["@graph"]) {
          if (node && typeof node === "object") graphs.push(node as Record<string, unknown>);
        }
      } else if (parsed && typeof parsed === "object") {
        graphs.push(parsed as Record<string, unknown>);
      }
    } catch {
      /* ignore */
    }
  }
  return graphs;
}

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n+/g, "\n");
}

function absCarstatUrl(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  if (t.startsWith("https://") || t.startsWith("http://")) return t;
  if (t.startsWith("/")) return `${CARSTAT_WEB_BASE}${t}`;
  return undefined;
}

function lotImageMatchesVin(url: string, vin: string): boolean {
  const needle = vin.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (needle.length !== 17) return true;
  const m = url.match(/\/api\/lot-image\/[a-f0-9-]+\/([A-HJ-NPR-Z0-9]{17})/i);
  if (!m?.[1]) return true;
  return m[1]!.toUpperCase() === needle;
}

/** Gallery order from alt/aria "Photo N of M" captions (hero strip + tiles). */
function extractCarstatPhotosByCaption(html: string): string[] {
  const byIndex = new Map<number, string>();
  for (const m of html.matchAll(
    /(?:alt|aria-label)=["']Photo\s+(\d+)\s+of\s+(\d+)[^"']*["'][^>]*?(?:src|href)=["']([^"']+)["']|(?:src|href)=["']([^"']+)["'][^>]*?(?:alt|aria-label)=["']Photo\s+(\d+)\s+of\s+(\d+)/gi,
  )) {
    const n = Number(m[1] || m[5]);
    const src = m[3] || m[4];
    if (!Number.isFinite(n) || n < 1 || !src) continue;
    const abs = absCarstatUrl(src);
    if (!abs || /thumbnail/i.test(abs)) continue;
    if (!byIndex.has(n)) byIndex.set(n, abs);
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, url]) => url);
}

/** Seller zone list: catalog card, RSC payload, or diagram aria-label. */
function extractCarstatDamageZones(html: string, catalog?: CarstatLotCard): string[] {
  const out: string[] = [];
  const push = (raw?: string | null) => {
    const t = String(raw ?? "")
      .toLowerCase()
      .replace(/_/g, " ")
      .trim();
    if (!t || out.includes(t)) return;
    if (/^(none|n\/a|unknown|no zones?)$/i.test(t)) return;
    out.push(t);
  };
  for (const z of catalog?.details?.damageZones ?? []) push(z);

  for (const m of html.matchAll(/"damageZones"\s*:\s*(\[[^\]]*\])/g)) {
    try {
      const arr = JSON.parse(m[1]!) as unknown;
      if (Array.isArray(arr)) for (const z of arr) push(String(z));
    } catch {
      /* ignore */
    }
  }

  const aria = html.match(
    /aria-label=["']Top-down vehicle diagram with zones marked:\s*([^"']+)["']/i,
  )?.[1];
  if (aria) {
    for (const part of aria.split(/[,;/|]+/)) push(part);
  }

  // Active legend chips (when Carstat marks a zone on the SVG).
  for (const m of html.matchAll(
    /DamageDiagram-module__[^"']*__(?:zone|legendItem|chip|on)[^"']*["'][^>]*>([^<]{2,24})</gi,
  )) {
    push(m[1]);
  }

  return out;
}

const DAMAGE_STAMP_RE =
  /전손|침수|화재|도난|교환|골격|총손실|엔진룸|하부|실내|외판|앞면|후면|측면|루프|total\s*loss|flood|fire|theft|collision|airbag\s+not\s+deployed|airbag\s+deployed|structural|frame\s*damage|rollover|hail/gi;

function damageEventType(classOrStamp: string): NormalizedEvent["eventType"] {
  const t = classOrStamp.toLowerCase();
  if (/total_loss|total\s*loss|전손|총손/.test(t)) return "total_loss";
  if (/flood|침수/.test(t)) return "flood_damage";
  if (/collision|accident|화재|fire/.test(t)) return "accident";
  return "other";
}

function humanDamageClass(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const t = raw.replace(/_/g, " ").trim();
  if (!t) return undefined;
  if (/전손|total\s*loss/i.test(t)) return "Total loss";
  if (/침수|flood/i.test(t)) return "Flood";
  if (/화재|fire/i.test(t)) return "Fire";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Parse lot HTML (+ optional catalog card) into a structured payload. */
export function parseCarstatLotHtml(
  html: string,
  sourceUrl: string,
  catalog?: CarstatLotCard,
): CarstatLotPayload {
  const lotId =
    lotIdFromHref(sourceUrl) ||
    catalog?.id ||
    html.match(/\/lot\/([a-f0-9-]{36})/i)?.[1]?.toLowerCase() ||
    "unknown";

  const graphs = extractJsonLdGraphs(html);
  const vehicle = graphs.find((g) => {
    const t = g["@type"];
    return t === "Vehicle" || (Array.isArray(t) && t.includes("Vehicle"));
  });

  const vin =
    normalizeKrVin(String(vehicle?.vehicleIdentificationNumber ?? "")) ||
    normalizeKrVin(String((vehicle?.identifier as { value?: string } | undefined)?.value ?? "")) ||
    normalizeKrVin(catalog?.vin) ||
    vinFromHref(sourceUrl) ||
    normalizeKrVin(html.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i)?.[1]);

  const title =
    String(vehicle?.name ?? "").trim() ||
    catalog?.details?.nameEn?.trim() ||
    [catalog?.year, titleCaseMake(catalog?.maker), modelDisplay(catalog?.model)]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    undefined;

  const brand =
    vehicle?.brand && typeof vehicle.brand === "object"
      ? String((vehicle.brand as { name?: string }).name ?? "")
      : "";
  const make = brand || titleCaseMake(catalog?.maker);
  const model = String(vehicle?.model ?? "").trim() || modelDisplay(catalog?.model);
  const year =
    parseYear(String(vehicle?.vehicleModelDate ?? "")) ||
    (catalog?.year && catalog.year > 1980 ? catalog.year : undefined);

  const mileageNode = vehicle?.mileageFromOdometer as
    | { value?: number; unitCode?: string }
    | undefined;
  const mileageKm =
    typeof mileageNode?.value === "number"
      ? mileageNode.value
      : typeof catalog?.mileage === "number"
        ? catalog.mileage
        : undefined;

  const engineNode = vehicle?.vehicleEngine as
    | { engineDisplacement?: { value?: number }; fuelType?: string }
    | undefined;
  const cc =
    engineNode?.engineDisplacement?.value ??
    (typeof catalog?.capacity === "number" ? catalog.capacity : undefined);
  const engineDisplacement = cleanEngineDisplacement(
    cc != null && Number.isFinite(cc) && cc > 0 ? `${Math.round(cc)} cc` : undefined,
  );

  const fuelType =
    mapFuel(String(vehicle?.fuelType ?? engineNode?.fuelType ?? "")) || mapFuel(catalog?.fuel);

  const photos: string[] = [];
  const pushPhoto = (raw?: string) => {
    const url = absCarstatUrl(String(raw ?? "").trim());
    if (!url) return;
    if (/\/thumbnail(?:\/|$)/i.test(url)) return;
    if (/\.(svg)(\?|$)/i.test(url)) return;
    if (/logo|icon|sprite|placeholder/i.test(url)) return;
    // Only keep stills for this VIN — related-lot thumbs share the host path.
    if (vin && !lotImageMatchesVin(url, vin)) return;
    if (photos.includes(url)) return;
    photos.push(url);
  };
  // 1) Prefer explicit "Photo N of M" order from the gallery strip / lightbox.
  for (const u of extractCarstatPhotosByCaption(html)) pushPhoto(u);
  // 2) JSON-LD Vehicle.image (usually full ordered set).
  const images = vehicle?.image;
  if (Array.isArray(images)) for (const u of images) pushPhoto(String(u));
  else if (typeof images === "string") pushPhoto(images);
  // 3) Photographs section only (avoid related-lot / OG noise elsewhere on the page).
  const galleryHtml =
    html.match(/aria-label=["']Photographs["'][\s\S]*?(?=<\/section>|$)/i)?.[0] ||
    html.match(/LotMediaStrip-module__[\s\S]{0,120000}/i)?.[0] ||
    "";
  for (const m of galleryHtml.matchAll(
    /(?:https:\/\/carstat\.info)?\/api\/lot-image\/[a-f0-9-]+\/(?!thumbnail)[A-HJ-NPR-Z0-9]{17}/gi,
  )) {
    pushPhoto(m[0]);
  }
  // 4) Last resort: whole-document URLs for this VIN only.
  if (photos.length < 3) {
    for (const m of html.matchAll(
      /(?:https:\/\/carstat\.info)?\/api\/lot-image\/[a-f0-9-]+\/(?!thumbnail)[A-HJ-NPR-Z0-9]{17}/gi,
    )) {
      pushPhoto(m[0]);
    }
  }

  const props = Array.isArray(vehicle?.additionalProperty)
    ? (vehicle!.additionalProperty as Array<{ name?: string; value?: string }>)
    : [];
  const propMap = new Map<string, string>();
  for (const p of props) {
    const n = String(p.name ?? "").trim().toLowerCase();
    const v = String(p.value ?? "").trim();
    if (n && v) propMap.set(n, v);
  }
  const prop = (...names: string[]) => {
    for (const n of names) {
      const v = propMap.get(n.toLowerCase());
      if (v) return v;
    }
    return undefined;
  };

  const damageFromLd = props
    .filter((p) => /damage/i.test(String(p.name ?? "")))
    .map((p) => String(p.value ?? "").trim())
    .filter(Boolean);

  const text = visibleText(html);
  const stamps = new Set<string>();
  for (const v of damageFromLd) {
    for (const part of v.split(/[·•|,/]/).map((s) => s.trim()).filter(Boolean)) stamps.add(part);
  }
  for (const m of text.matchAll(DAMAGE_STAMP_RE)) stamps.add(m[0]!.replace(/\s+/g, " ").trim());

  const damageClass =
    catalog?.details?.damageClass?.trim() ||
    prop("damage class", "damageclass", "damage_type") ||
    [...stamps].find((s) => /total\s*loss|전손/i.test(s))?.replace(/\s+/g, "_").toLowerCase() ||
    undefined;

  const damageZones = extractCarstatDamageZones(html, catalog);

  const lotNumber =
    text.match(/\bLot\s*(?:no\.?|number)?\s*[:#]?\s*([A-Z]?\d{2}-\d{5,})\b/i)?.[1] ||
    text.match(/\b(D\d{2}-\d{5,})\b/)?.[1] ||
    (catalog?.number != null ? String(catalog.number) : undefined);

  const airbagNote =
    text.match(/airbag\s+(not\s+)?deployed/i)?.[0] ||
    prop("airbag", "airbags");

  const color =
    String(vehicle?.color ?? "").trim() ||
    prop("color", "colour", "exterior color", "외장색", "색상") ||
    undefined;
  const transmission =
    String(vehicle?.vehicleTransmission ?? "").trim() ||
    prop("transmission", "gearbox", "변속기") ||
    undefined;
  const driveType =
    prop("drive", "drive type", "drivetrain", "구동방식") || undefined;
  const bodyType =
    String(vehicle?.bodyType ?? "").trim() ||
    prop("body", "body type", "차체") ||
    undefined;

  const badges: string[] = [];
  const pushBadge = (raw?: string) => {
    const t = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!t || badges.some((b) => b.toLowerCase() === t.toLowerCase())) return;
    badges.push(t);
  };
  if (damageClass) pushBadge(humanDamageClass(damageClass) || damageClass);
  for (const s of stamps) pushBadge(s);
  for (const z of damageZones) pushBadge(z);
  if (airbagNote) pushBadge(airbagNote);

  const sellerNotes: string[] = [];
  const sellerBlock = text.match(
    /MACHINE-TRANSLATED FROM THE SELLER[\s\S]{0,200}?([\s\S]{0,900}?)(?:ALSO STATED|DAMAGE ·|원문|WHAT THE VIN|THE SELLER'S KOREAN)/i,
  );
  const noteSource = sellerBlock?.[1] || "";
  for (const line of noteSource.split("\n")) {
    const t = line.replace(/^[-•*★]\s*/, "").trim();
    if (t.length < 8 || t.length > 220) continue;
    if (
      /positions?\s+\d|world-manufacturer|check digit|descriptor|agrees with the listing|in our data|copy vin|serial/i.test(
        t,
      )
    ) {
      continue;
    }
    if (/^(mercedes|bmw|hyundai|kia|tesla|audi|porsche|mini|lexus)\b/i.test(t) && t.length < 24) continue;
    if (/^\d{4}$/.test(t)) continue;
    sellerNotes.push(t);
    if (sellerNotes.length >= 8) break;
  }

  const description = String(vehicle?.description ?? "").trim() || undefined;

  return {
    lotId,
    sourceUrl: carstatDetailUrl(sourceUrl),
    vin,
    title,
    make,
    model,
    year,
    fuelType,
    mileageKm,
    engineDisplacement,
    lotNumber,
    endAt: parseCarstatDate(catalog?.endTime),
    listedAt: parseCarstatDate(catalog?.createdAt),
    damageClass,
    damageZones,
    damageStamps: [...stamps].slice(0, 20),
    badges: badges.slice(0, 24),
    airbagNote: airbagNote || undefined,
    sellerNotes,
    color,
    transmission,
    driveType,
    bodyType,
    photos: photos.slice(0, MAX_PHOTOS),
    description,
    catalog,
  };
}

function buildEvents(payload: CarstatLotPayload): NormalizedEvent[] {
  const when = payload.listedAt && !Number.isNaN(payload.listedAt.getTime()) ? payload.listedAt : new Date();
  const events: NormalizedEvent[] = [];
  const push = (
    eventType: NormalizedEvent["eventType"],
    description: string,
    metadata: Record<string, unknown>,
  ) => {
    events.push({ eventType, description, occurredAt: when, metadata: { source: "carstat", ...metadata } });
  };

  const damageLabel = humanDamageClass(payload.damageClass);
  if (damageLabel || payload.damageStamps?.length) {
    const stamps = payload.damageStamps?.join(" · ") || damageLabel || "damage";
    const eventType = damageEventType(payload.damageClass || stamps);
    const bodyPanels = panelsFromCarstatMarks(
      [...(payload.damageStamps ?? []), ...(payload.damageZones ?? []), ...(payload.badges ?? [])],
      payload.damageClass,
    );
    const stamp =
      humanDamageClass(payload.damageClass) ||
      payload.damageStamps?.map((s) => humanDamageClass(s) || s).find((s) => /total loss|flood|fire|theft/i.test(s)) ||
      undefined;
    push(eventType, `Damage: ${stamps}`, {
      field: "damage",
      damageClass: payload.damageClass,
      stamps: payload.damageStamps,
      zones: payload.damageZones,
      salvage: eventType === "total_loss" ? true : undefined,
      stamp,
      bodyCondition: bodyPanels.length > 0 || Boolean(stamp) ? true : undefined,
      panels: bodyPanels.length > 0 ? bodyPanels : undefined,
    });
  }
  if (payload.damageZones?.length) {
    push("other", `Damage zones: ${payload.damageZones.join(", ")}`, {
      field: "damage_zones",
      value: payload.damageZones.join(","),
    });
  }
  if (payload.badges?.length) {
    push("other", `Badges: ${payload.badges.join(" · ")}`, {
      field: "badges",
      value: payload.badges.join(","),
      badges: payload.badges,
    });
  }
  if (payload.airbagNote) {
    push("accident", `Airbags: ${payload.airbagNote}`, { field: "airbags", value: payload.airbagNote });
  }
  if (payload.lotNumber) {
    push("other", `Lot number: ${payload.lotNumber}`, { field: "lot_number", value: payload.lotNumber });
  }
  if (payload.endAt) {
    push("other", `Auction end: ${payload.endAt.toISOString()}`, {
      field: "end_time",
      value: payload.endAt.toISOString(),
    });
  }
  for (const note of payload.sellerNotes ?? []) {
    if (/mileage|vin:|jurisdiction|free products|bidder|engine, mission|please be sure|successful bidder/i.test(note)) {
      continue;
    }
    push("other", note, { field: "seller_note", value: note });
    if (events.length >= 10) break;
  }
  return events;
}

function listingFromPayload(payload: CarstatLotPayload): NormalizedListing {
  const vin = payload.vin ? normalizeKrVin(payload.vin) : undefined;
  const photos: NormalizedPhoto[] = payload.photos.map((sourceUrl, i) => ({
    sourceUrl,
    isPrimary: i === 0,
    sortOrder: i,
  }));

  const vehicle = vehicleFromParts({
    vin,
    make: payload.make,
    model: payload.model,
    year: payload.year,
    fuelType: payload.fuelType,
    engineDisplacement: payload.engineDisplacement,
    country: SOUTH_KOREA,
    color: payload.color,
    transmission: payload.transmission,
    bodyType: payload.bodyType,
    driveType: payload.driveType,
  });

  const extra = vehicle as Record<string, unknown>;
  if (payload.damageClass) extra.damageType = humanDamageClass(payload.damageClass) || payload.damageClass;
  if (payload.damageZones?.length) extra.damageZones = payload.damageZones;
  if (payload.damageStamps?.length) extra.damageStamps = payload.damageStamps;
  if (payload.badges?.length) extra.badges = payload.badges;
  if (payload.lotNumber) extra.stockNumber = payload.lotNumber;
  if (payload.airbagNote) extra.airbags = payload.airbagNote;
  if (payload.color) extra.color = payload.color;
  if (payload.transmission) extra.transmission = payload.transmission;
  if (payload.driveType) extra.driveType = payload.driveType;
  if (payload.bodyType) extra.bodyType = payload.bodyType;
  extra.auctionHouse = "Korean insurance auction";
  extra.source = "carstat";

  const base = krwListing({
    sourceId: payload.lotId,
    sourceUrl: payload.sourceUrl,
    title: payload.title || payload.lotId,
    mileage: payload.mileageKm,
    location: SOUTH_KOREA,
    vehicle,
    photos,
    sourceListedAt: payload.listedAt,
    sourceModifiedAt: payload.endAt,
  });

  return {
    ...base,
    events: buildEvents(payload),
  };
}

function refsFromCatalog(
  lots: CarstatLotCard[],
  vinOnly: boolean,
): ListingReference[] {
  const refs: ListingReference[] = [];
  const seen = new Set<string>();
  for (const lot of lots) {
    const vin = normalizeKrVin(lot.vin);
    if (vinOnly && !vin) continue;
    if (seen.has(lot.id)) continue;
    seen.add(lot.id);
    refs.push({
      sourceId: lot.id,
      url: carstatDetailUrl(lot.id, lot.maker || undefined, vin),
    });
  }
  return refs;
}

function refsFromHrefs(hrefs: string[], vinOnly: boolean): ListingReference[] {
  const refs: ListingReference[] = [];
  const seen = new Set<string>();
  for (const href of hrefs) {
    const id = lotIdFromHref(href);
    if (!id || seen.has(id)) continue;
    const vin = vinFromHref(href);
    if (vinOnly && !vin) continue;
    seen.add(id);
    refs.push({ sourceId: id, url: carstatDetailUrl(href) });
  }
  return refs;
}

export class CarstatHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "carstat";

  constructor(
    private _baseUrl?: string,
    private filters: CarstatFilterParams = {},
  ) {}

  private vinOnly(): boolean {
    return this.filters.vinOnly !== false;
  }

  async discoverListings(
    page: number,
  ): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const maxPages = Number(this.filters.maxPages);
    if (Number.isFinite(maxPages) && maxPages > 0 && page > maxPages) {
      return { listings: [], pagination: { currentPage: page, hasMore: false } };
    }

    const url = catalogPageUrl(page);
    const fetched = await csFetch(url);
    if (isCfChallenge(fetched.text)) {
      throw new Error(`Carstat catalog CF challenge on page ${page}`);
    }
    const lots = extractCarstatCatalogLots(fetched.text);
    // Always discover every lot card/href. Catalog "no VIN" is unreliable — many
    // lots only expose the VIN on the detail page. Pipeline skips after parse if
    // still no VIN (`skippedNoVin`).
    let listings = lots.length
      ? refsFromCatalog(lots, false)
      : refsFromHrefs(extractCarstatLotHrefs(fetched.text), false);

    const siteMaxRaw = extractCarstatMaxPage(fetched.text);
    // Soft/empty HTML without a pager must not end the crawl (CF interstitial, CDP flake).
    if (listings.length === 0 && siteMaxRaw == null && carstatCatalogMaxPage <= 0) {
      throw new Error(`Carstat catalog empty on page ${page} (no pager) — retry`);
    }
    const hasMoreBySize = lots.length >= PAGE_SIZE || extractCarstatLotHrefs(fetched.text).length >= PAGE_SIZE;
    const capped = Number.isFinite(maxPages) && maxPages > 0 ? page < maxPages : true;
    // Deep pages only render a nearby page window (e.g. 4648–4652). That must not
    // shrink EOF below the high-water mark from earlier catalog pages (~5743).
    const siteMax = Math.max(siteMaxRaw ?? 0, carstatCatalogMaxPage, hasMoreBySize ? page + 1 : 0);
    const hasMore =
      capped &&
      (siteMax > 0
        ? page < siteMax || hasMoreBySize
        : hasMoreBySize || listings.length > 0 || page < 8_000);

    return {
      listings,
      pagination: {
        currentPage: page,
        hasMore,
        totalPages: siteMax > 0 ? siteMax : undefined,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await csFetch(url);
    if (fetched.status === 404 || fetched.status === 410) {
      const err = new Error(`Carstat listing not found: ${url}`);
      (err as { statusCode?: number }).statusCode = fetched.status;
      throw err;
    }
    const payload = parseCarstatLotHtml(fetched.text, fetched.finalUrl || url);
    return {
      url: fetched.finalUrl || url,
      html: fetched.text,
      json: payload,
      statusCode: fetched.status,
      headers: {},
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const payload =
      (fetched.json as CarstatLotPayload | undefined) ??
      parseCarstatLotHtml(fetched.html ?? "", fetched.url);
    return listingFromPayload(payload);
  }

  async normalizeVehicle(listing: NormalizedListing): Promise<NormalizedVehicle> {
    return listing.vehicle ?? {};
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin ? normalizeKrVin(listing.vehicle.vin) : undefined;
  }

  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    return listing.photos ?? [];
  }
}
