/**
 * Autowini search/detail values → English vehicle fields, events, and photos.
 * The public v2 API already speaks English; this canonicalizes codes and aliases
 * so Autowini records match Encar (Diesel, Automatic, FWD, South Korea, …).
 */

import type { NormalizedEvent, NormalizedPhoto } from "@workspace/providers";
import { SOUTH_KOREA, withCountry } from "../geo";
import type { AutowiniDetailItem, AutowiniSearchItem } from "./autowini-http";

const MAKE_CANON: Record<string, string> = {
  "mercedes benz": "Mercedes-Benz",
  mercedes: "Mercedes-Benz",
  benz: "Mercedes-Benz",
  "kgm (ssangyong)": "KG Mobility",
  kgm: "KG Mobility",
  ssangyong: "KG Mobility",
  "ssangyong motor": "KG Mobility",
  vw: "Volkswagen",
  "mercedes-benz": "Mercedes-Benz",
};

const FUEL_CANON: Record<string, string> = {
  gasoline: "Gasoline",
  petrol: "Gasoline",
  diesel: "Diesel",
  "gasoline+electric": "Hybrid",
  "gasoline + electric": "Hybrid",
  hybrid: "Hybrid",
  "electric vehicle (ev)": "Electric",
  ev: "Electric",
  electric: "Electric",
  lpg: "LPG",
  "gasoline+lpg": "LPG",
  cng: "CNG",
  hydrogen: "Hydrogen",
  others: "Other",
};

const BODY_CANON: Record<string, string> = {
  sedan: "Sedan",
  suv: "SUV",
  "van/minivan": "Van",
  van: "Van",
  minivan: "Van",
  "compact car": "Compact",
  compact: "Compact",
  "pick up": "Pickup",
  pickup: "Pickup",
  hatchback: "Hatchback",
  coupe: "Coupe",
  convertible: "Convertible",
  wagon: "Wagon",
  truck: "Truck",
};

const TRANS_CANON: Record<string, string> = {
  at: "Automatic",
  automatic: "Automatic",
  auto: "Automatic",
  automanual: "Automatic",
  mt: "Manual",
  manual: "Manual",
  cvt: "CVT",
  dct: "DCT",
  unspecific: "Automatic",
};

const DRIVE_CANON: Record<string, string> = {
  "front 2wd": "FWD",
  fwd: "FWD",
  ff: "FWD",
  "rear 2wd": "RWD",
  rwd: "RWD",
  fr: "RWD",
  "4wd": "4WD",
  "4 wheel drive": "4WD",
  "4 wheel": "4WD",
  awd: "AWD",
};

const COLOR_CANON: Record<string, string> = {
  white: "White",
  black: "Black",
  charcoal: "Charcoal",
  gray: "Gray",
  grey: "Gray",
  blue: "Blue",
  silver: "Silver",
  pearl: "Pearl",
  red: "Red",
  brown: "Brown",
  green: "Green",
  yellow: "Yellow",
  orange: "Orange",
  beige: "Beige",
  gold: "Gold",
  purple: "Purple",
};

function canon(map: Record<string, string>, raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  const trimmed = raw.trim();
  const mapped = map[trimmed.toLowerCase()];
  if (mapped) return mapped;
  if (/^c\d+/i.test(trimmed)) return undefined;
  return trimmed;
}

export function normalizeAutowiniMake(raw?: string | null): string | undefined {
  return canon(MAKE_CANON, raw);
}

export function normalizeAutowiniFuel(raw?: string | null): string | undefined {
  return canon(FUEL_CANON, raw);
}

export function normalizeAutowiniBody(raw?: string | null): string | undefined {
  return canon(BODY_CANON, raw);
}

export function normalizeAutowiniTransmission(raw?: string | null): string | undefined {
  return canon(TRANS_CANON, raw);
}

export function normalizeAutowiniDrive(raw?: string | null): string | undefined {
  const mapped = canon(DRIVE_CANON, raw);
  return mapped || undefined;
}

export function normalizeAutowiniColor(raw?: string | null): string | undefined {
  return canon(COLOR_CANON, raw);
}

export function autowiniLocation(
  search: AutowiniSearchItem,
  detail: AutowiniDetailItem,
): string | undefined {
  const port = detail.tradePortName?.trim();
  if (port && !/^(s\.?\s*)?korea$/i.test(port)) {
    return withCountry(port, SOUTH_KOREA);
  }
  return withCountry(detail.tradeCountryName || search.locationName, SOUTH_KOREA);
}

export function autowiniMileage(search: AutowiniSearchItem, detail: AutowiniDetailItem): number | undefined {
  const raw = search.mileage ?? detail.mileage;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  if (raw === 0) return undefined;
  return raw;
}

export function autowiniPrice(search: AutowiniSearchItem, detail: AutowiniDetailItem): number | undefined {
  const listed = search.price ?? search.discountPrice ?? detail.itemPrice;
  if (typeof listed !== "number" || !Number.isFinite(listed) || listed <= 0) return undefined;
  return listed;
}

export function autowiniListingStatus(search: AutowiniSearchItem): {
  isActive: boolean;
  listingStatus: "active" | "sold" | "reserved" | "inactive";
} {
  if (search.almostSoldOut) return { isActive: true, listingStatus: "reserved" };
  return { isActive: true, listingStatus: "active" };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function extractAutowiniEvents(
  search: AutowiniSearchItem,
  detail: AutowiniDetailItem,
  collectedAt = new Date(),
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const push = (eventType: NormalizedEvent["eventType"], description: string, metadata?: Record<string, unknown>) => {
    events.push({ eventType, description, occurredAt: collectedAt, metadata: { source: "autowini", ...metadata } });
  };

  if (search.odometerCheck === false || (typeof search.mileage === "number" && search.mileage <= 0)) {
    push("other", "Odometer reading not actual", { field: "odometerCheck" });
  }
  if (search.hasInsuranceHistory) {
    push("other", "VIN / insurance history on file", { field: "hasInsuranceHistory" });
  }
  if (search.inspectionReportUploaded) {
    push("inspection", "Autowini inspection report uploaded", { field: "inspectionReportUploaded" });
  }
  const steering = str(search.steeringType);
  if (steering) {
    push("other", `Steering: ${steering === "LHD" || /left/i.test(steering) ? "Left-hand drive" : steering === "RHD" || /right/i.test(steering) ? "Right-hand drive" : steering}`, {
      field: "steeringType",
      value: steering,
    });
  }
  const firstReg = str(search.firstRegistrationDate) || str(detail.firstRegistrationDate);
  if (firstReg) {
    const occurredAt = parseAutowiniDate(firstReg) ?? collectedAt;
    events.push({
      eventType: "delivery",
      description: `First registration: ${firstReg}`,
      occurredAt,
      metadata: { source: "autowini", field: "firstRegistrationDate", value: firstReg },
    });
  }

  const flags: Array<[string, NormalizedEvent["eventType"], string]> = [
    ["waterFloodDamaged", "flood_damage", "Water / flood damaged"],
    ["floodDamaged", "flood_damage", "Water / flood damaged"],
    ["salvageRecord", "total_loss", "Salvage record"],
    ["recoveredTheft", "other", "Recovered theft"],
    ["formerRentalCar", "other", "Former rental car"],
    ["formerTaxi", "other", "Former taxi"],
    ["policeCar", "other", "Former police car"],
    ["fuelConversion", "other", "Fuel conversion"],
    ["modifiedSeats", "other", "Modified seats"],
  ];
  for (const [field, eventType, description] of flags) {
    if (truthyFlag(search[field] ?? detail[field])) {
      push(eventType, description, { field });
    }
  }

  return events;
}

function truthyFlag(value: unknown): boolean {
  if (value === true || value === "Y" || value === "YES") return true;
  if (typeof value === "string" && /^true|yes$/i.test(value) && !/^no$/i.test(value)) return true;
  return false;
}

function parseAutowiniDate(raw: string): Date | undefined {
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d;
  const m = raw.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?\s+(\d{4})/);
  if (m) {
    const parsed = new Date(`${m[2]} ${m[1]}, ${m[3]}`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

function upgradePhotoUrl(url: string): string {
  const trimmed = url.trim();
  const absolute = trimmed.startsWith("//")
    ? `https:${trimmed}`
    : trimmed.startsWith("/")
      ? `https://imagebox.autowini.com${trimmed}`
      : trimmed;
  return absolute.replace(/_320(\.[a-z0-9]+)$/i, "_720$1");
}

export function collectAutowiniPhotos(
  search: AutowiniSearchItem,
  detail: AutowiniDetailItem,
): NormalizedPhoto[] {
  const urls: string[] = [];
  const add = (raw?: string | null) => {
    if (!raw?.trim()) return;
    const url = upgradePhotoUrl(raw.trim());
    if (!urls.includes(url)) urls.push(url);
  };
  add(search.mainThumbnailPath);
  add(search.subThumbnail1Path);
  add(search.subThumbnail2Path);
  for (const url of search.thumbnails ?? []) add(url);
  add(detail.imageUrl);
  return urls.map((sourceUrl, sortOrder) => ({
    sourceUrl,
    isPrimary: sortOrder === 0,
    sortOrder,
  }));
}

export function pickAutowiniColor(search: AutowiniSearchItem, detail: AutowiniDetailItem): string | undefined {
  const raw =
    str(search.exteriorColor) ||
    str(search.exteriorColorName) ||
    str(search.colorName) ||
    str(search.color) ||
    str(detail.exteriorColor) ||
    str(detail.exteriorColorName) ||
    str(detail.colorName) ||
    str(detail.color);
  return normalizeAutowiniColor(raw) ?? raw;
}
