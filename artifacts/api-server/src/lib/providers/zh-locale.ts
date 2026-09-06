/**
 * Normalize Chinese marketplace detail strings to English before storage.
 * Used when Autohome/Che168 (or other CN feeds) return zh labels.
 */

function fold(raw: string): string {
  return raw.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

const COLOR_MAP: Array<[RegExp, string]> = [
  [/黑|black/, "Black"],
  [/白|white/, "White"],
  [/灰|grey|gray/, "Grey"],
  [/银|silver/, "Silver"],
  [/蓝|blue/, "Blue"],
  [/红|red/, "Red"],
  [/绿|green/, "Green"],
  [/黄|yellow/, "Yellow"],
  [/橙|orange/, "Orange"],
  [/棕|褐|brown/, "Brown"],
  [/米|beige|香槟/, "Beige"],
  [/金|gold/, "Gold"],
  [/紫|purple/, "Purple"],
  [/粉|pink/, "Pink"],
  [/咖啡/, "Brown"],
];

const BODY_MAP: Array<[RegExp, string]> = [
  [/suv|越野/, "SUV"],
  [/mpv|面包|旅行车|wagon|estate/, "MPV"],
  [/轿跑|coupe|跑车|sports?\s*car/, "Coupe"],
  [/两厢|hatch/, "Hatchback"],
  [/三厢|sedan|轿车/, "Sedan"],
  [/敞篷|convertible|cabrio/, "Convertible"],
  [/皮卡|pickup/, "Pickup"],
  [/客车|van|商务/, "Van"],
  [/卡车|truck|货车/, "Truck"],
];

const FUEL_MAP: Array<[RegExp, string]> = [
  [/柴油|diesel/, "Diesel"],
  [/汽油|gasoline|petrol|油电|燃油/, "Gasoline"],
  [/插电|plug.?in|phev/, "Plug-in Hybrid"],
  [/混动|hybrid|油电混合/, "Hybrid"],
  [/纯电|电动|electric|新能源|ev\b/, "Electric"],
  [/天然气|cng/, "CNG"],
  [/液化|lpg/, "LPG"],
  [/氢|hydrogen/, "Hydrogen"],
];

const TRANS_MAP: Array<[RegExp, string]> = [
  [/自动|cvt|双离合|手自一体|at\b|automatic|无级/, "Automatic"],
  [/手动|mt\b|manual/, "Manual"],
];

function mapFirst(raw: string | undefined | null, table: Array<[RegExp, string]>): string | undefined {
  if (!raw) return undefined;
  const text = fold(raw);
  if (!text || text === "--" || text === "-" || text === "无") return undefined;
  for (const [re, label] of table) {
    if (re.test(text)) return label;
  }
  // Already English-ish — title-case lightly
  if (/^[a-z0-9][a-z0-9\s\-/.+]*$/i.test(raw.trim()) && !/[\u4e00-\u9fff]/.test(raw)) {
    return raw.trim();
  }
  return undefined;
}

export function normalizeZhColor(raw?: string | null): string | undefined {
  return mapFirst(raw, COLOR_MAP);
}

export function normalizeZhBodyType(raw?: string | null): string | undefined {
  return mapFirst(raw, BODY_MAP);
}

export function normalizeZhFuel(raw?: string | null): string | undefined {
  return mapFirst(raw, FUEL_MAP);
}

export function normalizeZhTransmission(raw?: string | null): string | undefined {
  return mapFirst(raw, TRANS_MAP);
}

export function titleCaseCity(raw?: string | null): string | undefined {
  const t = raw?.trim();
  if (!t || t === "--") return undefined;
  return t
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
