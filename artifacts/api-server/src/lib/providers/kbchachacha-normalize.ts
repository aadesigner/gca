/**
 * KB ChaChaCha HTML → English vehicle fields, events, and photos.
 * Public pages are Korean; VIN is on the Carmodoo inspection sheet.
 */

import { load } from "cheerio";
import type { NormalizedEvent, NormalizedPhoto } from "@workspace/providers";
import { SOUTH_KOREA } from "../geo";
import { forceEnglish, translateEncarMake, translateEncarModel } from "./encar-catalog";
import {
  containsHangul,
  normalizeEncarBody,
  normalizeEncarColor,
  normalizeEncarFuel,
  normalizeEncarLocation,
  normalizeEncarMaker,
  normalizeEncarTransmission,
} from "./encar-locale";

export interface KbSearchCard {
  carSeq: string;
  title?: string;
  priceKrw?: number;
  year?: number;
  yearText?: string;
  mileage?: number;
  fuel?: string;
  location?: string;
  thumbnail?: string;
  sold?: boolean;
}

export interface KbHistoryFlags {
  accidentCount: number;
  totalLoss: boolean;
  flood: boolean;
  commercialUse: boolean;
  ownerChangeCount: number;
  insuranceQueryDate?: string;
  accidentSummary?: string;
}

export interface KbParsedListing {
  carSeq: string;
  title: string;
  make?: string;
  model?: string;
  trim?: string;
  year?: number;
  firstRegistration?: string;
  plate?: string;
  priceKrw?: number;
  msrpKrw?: number;
  mileage?: number;
  fuel?: string;
  transmission?: string;
  bodyType?: string;
  color?: string;
  seatColor?: string;
  engineDisplacement?: string;
  location?: string;
  photos: string[];
  options: string[];
  sold: boolean;
  checkNum?: string;
  inspectionUrl?: string;
  vin?: string;
  seizure?: boolean;
  mortgage?: boolean;
  taxUnpaid?: boolean;
  makerCode?: string;
  carCode?: string;
  shopNo?: string;
  history: KbHistoryFlags;
}

const COLOR_EXTRA: Record<string, string> = {
  미색: "Ivory",
  진주색: "Pearl",
  진주: "Pearl",
  은하색: "Galaxy Silver",
  검정: "Black",
  흰색: "White",
};

const OPTION_PHRASES: Array<[RegExp, string]> = [
  [/헤드업디스플레이/g, "Head-up display"],
  [/후측방\s*경고시스템/g, "Blind-spot warning"],
  [/차선이탈경보/g, "Lane departure warning"],
  [/주차감지센서/g, "Parking sensors"],
  [/크루즈\s*컨트롤/g, "Cruise control"],
  [/열선\s*스티어링\s*휠/g, "Heated steering wheel"],
  [/스티어링\s*휠/g, "Steering wheel"],
  [/내비게이션/g, "Navigation"],
  [/선루프/g, "Sunroof"],
  [/헤드램프/g, "Headlamps"],
  [/통풍시트/g, "Ventilated seats"],
  [/열선시트/g, "Heated seats"],
  [/어라운드뷰/g, "Surround view"],
  [/순정/g, "OEM"],
  [/파노라마/g, "Panoramic"],
  [/어댑티드/g, "Adaptive"],
  [/운전석/g, "Driver"],
  [/동승석/g, "Passenger"],
  [/앞좌석/g, "Front seats"],
  [/뒷좌석/g, "Rear seats"],
  [/후방/g, "Rear"],
  [/전방/g, "Front"],
];

const REGION_TOKENS = [
  "서울",
  "부산",
  "대구",
  "인천",
  "광주",
  "대전",
  "울산",
  "세종",
  "경기",
  "강원",
  "충북",
  "충남",
  "전북",
  "전남",
  "경북",
  "경남",
  "제주",
];

export function normalizeKbVin(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const clean = raw.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (clean.length !== 17) return undefined;
  if (/^(.)\1{16}$/.test(clean)) return undefined;
  return clean;
}

export function parseKbYear(raw?: string | null): {
  modelYear?: number;
  firstRegYear?: number;
  firstRegMonth?: number;
} {
  if (!raw?.trim()) return {};
  const text = raw.trim();
  const twoDigitYear = (yy: number): number => {
    const current = new Date().getFullYear() % 100;
    return yy <= current + 2 ? 2000 + yy : 1900 + yy;
  };
  const modelMatch = text.match(/\((\d{2})년형\)/) ?? text.match(/(\d{4})년형/);
  let modelYear: number | undefined;
  if (modelMatch) {
    const n = Number(modelMatch[1]);
    modelYear = n >= 1000 ? n : twoDigitYear(n);
  }
  const first =
    text.match(/(\d{2})년\s*(\d{1,2})월/) ??
    text.match(/(\d{2})\/(\d{1,2})식/) ??
    text.match(/(\d{4})[.\-/](\d{1,2})/);
  let firstRegYear: number | undefined;
  let firstRegMonth: number | undefined;
  if (first) {
    const y = Number(first[1]);
    firstRegYear = y >= 1000 ? y : twoDigitYear(y);
    firstRegMonth = Number(first[2]);
  }
  if (modelYear == null && firstRegYear != null) modelYear = firstRegYear;
  return { modelYear, firstRegYear, firstRegMonth };
}

function jsVar(html: string, name: string): string | undefined {
  const match = html.match(new RegExp(`var\\s+${name}\\s*=\\s*"([^"]*)"`, "i"));
  return match?.[1]?.trim() || undefined;
}

function collapseWs(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function parseIntLoose(raw?: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function parseManwon(raw?: string | null): number | undefined {
  const n = parseIntLoose(raw);
  if (n == null || n <= 0) return undefined;
  return n * 10_000;
}

function isNone(raw?: string | null): boolean {
  if (!raw?.trim()) return true;
  return /없음|무사고/.test(raw) && !/있음/.test(raw);
}

function parseCount(raw?: string | null): number {
  if (!raw?.trim() || isNone(raw)) return 0;
  const times = raw.match(/(\d+)\s*회/);
  if (times) return Number(times[1]);
  if (/있음/.test(raw)) return 1;
  return 0;
}

function lookupColor(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  const trimmed = raw.trim();
  if (COLOR_EXTRA[trimmed]) return COLOR_EXTRA[trimmed];
  return normalizeEncarColor(trimmed) ?? (containsHangul(trimmed) ? undefined : trimmed);
}

function translateOption(raw: string): string {
  let text = collapseWs(raw);
  for (const [pattern, replacement] of OPTION_PHRASES) {
    text = text.replace(pattern, replacement);
  }
  return forceEnglish(text) ?? text;
}

function englishTitle(raw: string): string {
  let text = raw.replace(/\([^)]*년형\)/g, "").replace(/([\uAC00-\uD7AF]+)(\d+)/g, "$1 $2");
  text = text.replace(/[\uAC00-\uD7AF]+/g, (word) => translateEncarMake(word) ?? word);
  text = translateEncarModel(text) ?? text;
  text = forceEnglish(text) ?? text;
  return text
    .replace(/([A-Za-z])Class\b/g, "$1-Class")
    .replace(/(\d)Gen\b/g, "$1 Gen")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function splitKbName(
  productName: string,
  brandRaw?: string,
): { make?: string; model?: string; trim?: string; title: string } {
  const firstToken = productName.replace(/([\uAC00-\uD7AF]+)(\d+)/g, "$1 $2").split(/\s+/)[0];
  const make = normalizeEncarMaker(brandRaw) ?? normalizeEncarMaker(firstToken);
  const english = englishTitle(productName);
  if (!make) return { title: english, model: english };
  const escaped = make.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const after = english.replace(new RegExp(`^(?:${escaped}\\s+)+`, "i"), "").trim();
  const title = after ? `${make} ${after}`.replace(/\s{2,}/g, " ").trim() : make;
  const tokens = after.split(/\s+/).filter(Boolean);
  if (!tokens.length) return { make, model: make, title };
  if (/^\d+[A-Za-z]?$/.test(tokens[0]) || /^[A-Z]\d+$/i.test(tokens[0])) {
    return { make, model: `${make} ${tokens[0]}`, trim: tokens.slice(1).join(" ") || undefined, title };
  }
  if (/^Model$/i.test(tokens[0]) && tokens[1] && /^(3|S|X|Y)$/i.test(tokens[1])) {
    return {
      make,
      model: `Model ${tokens[1].toUpperCase()}`,
      trim: tokens.slice(2).join(" ") || undefined,
      title,
    };
  }
  if (/^(New|The)$/i.test(tokens[0]) && tokens[1]) {
    const take = /^New$/i.test(tokens[1]) ? 3 : 2;
    return {
      make,
      model: tokens.slice(0, take).join(" "),
      trim: tokens.slice(take).join(" ") || undefined,
      title,
    };
  }
  return { make, model: tokens[0], trim: tokens.slice(1).join(" ") || undefined, title };
}

function canonicalizePhoto(raw: string): string | undefined {
  let url = raw.trim();
  if (!url) return undefined;
  if (url.startsWith("//")) url = `https:${url}`;
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    const parsed = new URL(url);
    if (!/kbchachacha\.com$/i.test(parsed.hostname) && !/img\.kbchachacha\.com$/i.test(parsed.hostname)) {
      if (!parsed.hostname.toLowerCase().includes("kbchachacha")) return undefined;
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function parseJsonLd(html: string): {
  name?: string;
  brand?: string;
  price?: number;
  images: string[];
  availability?: string;
  description?: string;
} {
  const images: string[] = [];
  let name: string | undefined;
  let brand: string | undefined;
  let price: number | undefined;
  let availability: string | undefined;
  let description: string | undefined;
  const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of blocks) {
    const inner = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const json = JSON.parse(inner) as {
        "@type"?: string;
        name?: string;
        brand?: { name?: string } | string;
        image?: string[] | string;
        description?: string;
        offers?: { price?: string | number; availability?: string };
      };
      if (json["@type"] !== "Product" && !json.offers) continue;
      name = json.name ?? name;
      brand = typeof json.brand === "string" ? json.brand : json.brand?.name ?? brand;
      description = json.description ?? description;
      const listed = json.offers?.price;
      const n = typeof listed === "number" ? listed : parseIntLoose(listed);
      if (n && n > 0) price = n;
      availability = json.offers?.availability ?? availability;
      const imgs = Array.isArray(json.image) ? json.image : json.image ? [json.image] : [];
      for (const img of imgs) {
        const url = canonicalizePhoto(img);
        if (url && !images.includes(url)) images.push(url);
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return { name, brand, price, images, availability, description };
}

function specTable($: ReturnType<typeof load>): Record<string, string> {
  const out: Record<string, string> = {};
  $("table.detail-info-table th").each((_, th) => {
    const key = collapseWs($(th).text());
    const val = collapseWs($(th).next("td").text());
    if (key) out[key] = val;
  });
  return out;
}

function historyFromHtml($: ReturnType<typeof load>, html: string): KbHistoryFlags {
  const map: Record<string, string> = {};
  $(".detail-info02 dl dt").each((_, dt) => {
    const key = collapseWs($(dt).text());
    const val = collapseWs($(dt).next("dd").text());
    if (key) map[key] = val;
  });
  const accidentText = collapseWs($("#btnCarHistoryView2, .detail-txt-link02 .link-arrow").first().text()) ||
    (html.includes("사고없음") ? "사고없음" : undefined);
  const queryDate = html.match(/보험사고정보\s*조회일자\s*:\s*([\d.]+)/)?.[1];
  return {
    accidentCount: parseCount(accidentText) || (/사고없음/.test(accidentText ?? "") ? 0 : parseCount(accidentText)),
    totalLoss: parseCount(map["전손이력"]) > 0 || /있음/.test(map["전손이력"] ?? ""),
    flood: parseCount(map["침수이력"]) > 0 || /있음/.test(map["침수이력"] ?? ""),
    commercialUse: parseCount(map["용도이력"]) > 0 || /있음/.test(map["용도이력"] ?? ""),
    ownerChangeCount: parseCount(map["소유자변경"]),
    insuranceQueryDate: queryDate?.replace(/\./g, "-"),
    accidentSummary: accidentText ? translateOption(accidentText) : undefined,
  };
}

function ga4VehicleInfo(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const json = JSON.parse(raw) as { params?: { vehicle_info?: string } };
    return json.params?.vehicle_info?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function fuelFromText(text: string): string | undefined {
  if (/하이브리드|PHEV|\bHEV\b|Hybrid/i.test(text)) return "Hybrid";
  if (/전기|\bEV\b|Electric/i.test(text)) return "Electric";
  if (/디젤|Diesel/i.test(text)) return "Diesel";
  if (/LPG/i.test(text)) return "LPG";
  if (/가솔린|Gasoline|Petrol/i.test(text)) return "Gasoline";
  return undefined;
}

export function parseKbSearchHtml(html: string): KbSearchCard[] {
  const $ = load(html);
  const cards: KbSearchCard[] = [];
  const seen = new Set<string>();

  $("div.area[data-car-seq]").each((_, el) => {
    const root = $(el);
    const carSeq = root.attr("data-car-seq")?.trim();
    if (!carSeq || !/^\d+$/.test(carSeq) || seen.has(carSeq)) return;
    seen.add(carSeq);
    const text = collapseWs(root.text());
    const rawTitle =
      collapseWs(root.find("strong.tit").first().text()) ||
      ga4VehicleInfo(root.find("[data-ga4]").first().attr("data-ga4"));
    const names = rawTitle ? splitKbName(rawTitle) : undefined;
    const manwon = text.match(/([\d,]+)\s*만원/);
    const km = text.match(/([\d,]+)\s*km/i);
    const yearText =
      text.match(/\d{2}년\s*\d{1,2}월(?:\(\d{2}년형\))?/)?.[0] ??
      text.match(/\d{2}\/\d{2}식(?:\(\d{2}년형\))?/)?.[0];
    const region = REGION_TOKENS.find((token) => text.includes(token));
    let thumbnail: string | undefined;
    root.find("img[src]").each((__, img) => {
      if (thumbnail) return;
      thumbnail = canonicalizePhoto($(img).attr("src") ?? "");
    });
    cards.push({
      carSeq,
      title: names?.title,
      priceKrw: parseManwon(manwon?.[1]),
      year: parseKbYear(yearText).modelYear,
      yearText,
      mileage: parseIntLoose(km?.[1]),
      fuel: fuelFromText(`${rawTitle ?? ""} ${text}`),
      location: region ? normalizeEncarLocation(region) : undefined,
      thumbnail,
      sold: /판매완료|판매가 완료/.test(text),
    });
  });

  return cards;
}

export function parseKbDetailHtml(html: string, carSeqHint?: string): KbParsedListing {
  const $ = load(html);
  const jsonLd = parseJsonLd(html);
  const specs = specTable($);
  const carSeq = jsVar(html, "carSeq") || carSeqHint || "unknown";
  const brand = jsonLd.brand;
  const productName =
    jsonLd.name ||
    collapseWs($(".car-buy-name").text()).replace(/^\([^)]+\)/, "") ||
    collapseWs($("title").first().text());
  const names = splitKbName(productName, brand);
  const yearInfo = parseKbYear(specs["연식"] || $(".txt-info span").first().text());
  const sellAmt = parseManwon(jsVar(html, "sellAmt"));
  const newcarPrice = parseManwon(jsVar(html, "newcarPrice"));
  const jsonPrice = jsonLd.price && jsonLd.price > 1000 ? jsonLd.price : undefined;
  const inspectionUrl =
    $("[data-link-url*='carmodooPrint']").first().attr("data-link-url") ||
    html.match(/https:\/\/ck\.carmodoo\.com\/carCheck\/carmodooPrint\.do[^"'<\s]+/)?.[0];
  const checkNum = inspectionUrl?.match(/checkNum=(\d+)/)?.[1];
  const photos: string[] = [...jsonLd.images];
  $("img[src*='img.kbchachacha.com']").each((_, img) => {
    const url = canonicalizePhoto($(img).attr("src") ?? "");
    if (url && !photos.includes(url)) photos.push(url);
  });
  const options: string[] = [];
  $(".car-option-list li:not(.option_more) .text").each((_, el) => {
    const label = translateOption($(el).text());
    if (label && !options.includes(label)) options.push(label);
  });
  const regionSpan = $(".txt-info span")
    .toArray()
    .map((el) => collapseWs($(el).text()))
    .find((t) => REGION_TOKENS.some((r) => t.includes(r)));
  const place = collapseWs($(".place-add").first().text());
  const location = normalizeEncarLocation(regionSpan || place || jsonLd.description?.match(/^(서울|경기|부산|인천|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)/)?.[1]);
  const sold =
    /판매가 완료된 차량/.test(html) ||
    /OutOfStock/i.test(jsonLd.availability ?? "");
  const displacement = specs["배기량"] && !/정보없음/.test(specs["배기량"])
    ? forceEnglish(specs["배기량"]) ?? specs["배기량"]
    : undefined;

  return {
    carSeq,
    title: names.title,
    make: names.make,
    model: names.model,
    trim: names.trim,
    year: yearInfo.modelYear,
    firstRegistration:
      yearInfo.firstRegYear && yearInfo.firstRegMonth
        ? `${yearInfo.firstRegYear}-${String(yearInfo.firstRegMonth).padStart(2, "0")}`
        : undefined,
    plate: specs["차량정보"] || undefined,
    priceKrw: jsonPrice ?? sellAmt,
    msrpKrw: newcarPrice,
    mileage: parseIntLoose(specs["주행거리"]),
    fuel:
      fuelFromText(`${names.title} ${specs["연료"] ?? ""} ${productName}`) ??
      normalizeEncarFuel({ fuelName: specs["연료"] }),
    transmission: normalizeEncarTransmission(specs["변속기"]),
    bodyType: normalizeEncarBody(specs["차종"]),
    color: lookupColor(specs["차량색상"]),
    seatColor: lookupColor(specs["시트색상"]),
    engineDisplacement: displacement,
    location,
    photos,
    options,
    sold,
    checkNum,
    inspectionUrl: inspectionUrl || undefined,
    makerCode: jsVar(html, "makerCode"),
    carCode: jsVar(html, "carCode"),
    shopNo: jsVar(html, "shopNo"),
    seizure: !isNone(specs["압류"]),
    mortgage: !isNone(specs["저당"]),
    taxUnpaid: !isNone(specs["세금미납"]),
    history: historyFromHtml($, html),
  };
}

export function parseKbInspectionHtml(html: string): { vin?: string; firstRegistration?: string } {
  const nearVin = html.match(/차대번호[\s\S]{0,240}?([A-HJ-NPR-Z0-9]{17})/i);
  const vin = normalizeKbVin(nearVin?.[1]) ?? findBestVin(html);
  const iso = html.match(/최초등록일[\s\S]{0,160}?(\d{4}-\d{2}-\d{2})/);
  const parts = html.match(/최초등록일[\s\S]{0,160}?(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/);
  const firstRegistration = iso?.[1]
    ? iso[1]
    : parts
      ? `${parts[1]}-${parts[2].padStart(2, "0")}-${parts[3].padStart(2, "0")}`
      : undefined;
  return { vin, firstRegistration };
}

function findBestVin(html: string): string | undefined {
  const matches = html.match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) ?? [];
  for (const candidate of matches) {
    const vin = normalizeKbVin(candidate);
    if (vin) return vin;
  }
  return undefined;
}

export function kbListingStatus(parsed: { sold?: boolean }): {
  isActive: boolean;
  listingStatus: "active" | "sold" | "reserved" | "inactive";
} {
  if (parsed.sold) return { isActive: false, listingStatus: "sold" };
  return { isActive: true, listingStatus: "active" };
}

export function collectKbPhotos(parsed: KbParsedListing): NormalizedPhoto[] {
  return parsed.photos.map((sourceUrl, sortOrder) => ({
    sourceUrl,
    isPrimary: sortOrder === 0,
    sortOrder,
  }));
}

export function extractKbEvents(parsed: KbParsedListing, collectedAt = new Date()): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const push = (
    eventType: NormalizedEvent["eventType"],
    description: string,
    metadata?: Record<string, unknown>,
    occurredAt?: Date,
  ) => {
    events.push({
      eventType,
      description,
      occurredAt: occurredAt ?? collectedAt,
      metadata: { source: "kbchachacha", ...metadata },
    });
  };

  if (parsed.inspectionUrl || parsed.checkNum) {
    push("inspection", "Official inspection record on file", {
      field: "inspection",
      checkNum: parsed.checkNum,
      url: parsed.inspectionUrl,
    });
  }
  if (parsed.firstRegistration) {
    const occurredAt = new Date(`${parsed.firstRegistration}${parsed.firstRegistration.length === 7 ? "-01" : ""}T00:00:00+09:00`);
    push(
      "delivery",
      `First registration: ${parsed.firstRegistration}`,
      { field: "firstRegistration", value: parsed.firstRegistration },
      Number.isNaN(occurredAt.getTime()) ? collectedAt : occurredAt,
    );
  }
  if (parsed.sold) {
    push("sale", parsed.priceKrw != null ? `Sold for ₩${parsed.priceKrw.toLocaleString("en-US")}` : "Sold", {
      field: "sale",
      priceAmount: parsed.priceKrw,
      priceCurrency: "KRW",
      sourceListingId: parsed.carSeq,
    });
  }
  if (parsed.history.accidentCount > 0) {
    push("accident", `Accident record (${parsed.history.accidentCount})`, {
      field: "accidentCount",
      count: parsed.history.accidentCount,
    });
  }
  if (parsed.history.totalLoss) {
    push("total_loss", "Total-loss record", { field: "totalLoss" });
  }
  if (parsed.history.flood) {
    push("flood_damage", "Flood-damage record", { field: "flood" });
  }
  if (parsed.history.ownerChangeCount > 0) {
    push("owner_change", `Owner changes: ${parsed.history.ownerChangeCount}`, {
      field: "ownerChangeCount",
      count: parsed.history.ownerChangeCount,
    });
  }
  if (parsed.history.commercialUse) {
    push("other", "Commercial-use history", { field: "commercialUse" });
  }
  if (parsed.seizure) push("other", "Seizure on record", { field: "seizure" });
  if (parsed.mortgage) push("other", "Mortgage on record", { field: "mortgage" });
  if (parsed.taxUnpaid) push("other", "Unpaid tax on record", { field: "taxUnpaid" });
  if (parsed.plate) {
    push("other", `License plate: ${parsed.plate}`, { field: "plate", value: parsed.plate });
  }
  if (parsed.seatColor) {
    push("other", `Seat color: ${parsed.seatColor}`, { field: "seatColor", value: parsed.seatColor });
  }
  if (parsed.msrpKrw) {
    push("other", `New-car price: ₩${parsed.msrpKrw.toLocaleString("en-US")}`, {
      field: "msrp",
      value: parsed.msrpKrw,
    });
  }
  return events;
}

export function kbMatchesLocalFilters(
  card: Pick<KbSearchCard, "title" | "year" | "mileage" | "fuel" | "location" | "priceKrw">,
  filters: {
    make?: string;
    brand?: string;
    yearFrom?: number;
    yearTo?: number;
    fuel?: string;
    minMileage?: number;
    maxMileage?: number;
    minPrice?: number;
    maxPrice?: number;
    location?: string;
    keyword?: string;
  },
): boolean {
  const make = (filters.make || filters.brand || "").trim().toLowerCase();
  if (make && card.title && !card.title.toLowerCase().includes(make)) return false;
  if (filters.keyword && card.title && !card.title.toLowerCase().includes(filters.keyword.toLowerCase())) {
    return false;
  }
  if (filters.yearFrom != null && (card.year ?? 0) < filters.yearFrom) return false;
  if (filters.yearTo != null && (card.year ?? 9999) > filters.yearTo) return false;
  if (filters.fuel && card.fuel && !card.fuel.toLowerCase().includes(filters.fuel.toLowerCase())) return false;
  if (filters.minMileage != null && (card.mileage ?? 0) < filters.minMileage) return false;
  if (filters.maxMileage != null && (card.mileage ?? Number.MAX_SAFE_INTEGER) > filters.maxMileage) return false;
  if (filters.minPrice != null && (card.priceKrw ?? 0) < filters.minPrice) return false;
  if (filters.maxPrice != null && (card.priceKrw ?? Number.MAX_SAFE_INTEGER) > filters.maxPrice) return false;
  if (filters.location && card.location && !card.location.toLowerCase().includes(filters.location.toLowerCase())) {
    return false;
  }
  return true;
}

export { SOUTH_KOREA };
