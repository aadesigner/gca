/**
 * Normalize EU marketplace vehicle detail strings to English before storage.
 * Covers SK/CS/BG/IT/PT/NL/DE (+ common EN aliases).
 */

function fold(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const COLOR_MAP: Array<[RegExp, string]> = [
  [/^(black|schwarz|zwart|nero|preto|negro|cern[aay]|ciern[aay]|chern)/i, "Black"],
  [/^(white|weiss|weiß|wit|bianco|branco|blanco|biela|bila|bil[aay]|byal)/i, "White"],
  [/^(grey|gray|grau|grijs|grigio|cinza|gris|siv[aay]|sed[aay]|siv)/i, "Grey"],
  [/^(silver|silber|zilver|argento|prata|plata|striebor|stribr)/i, "Silver"],
  [/^(blue|blau|blauw|blu|azul|modr[aay]|sin)/i, "Blue"],
  [/^(red|rot|rood|rosso|vermelho|rojo|cerv[eo]n|cherven|bordo|bordov)/i, "Red"],
  [/^(green|gruen|grün|groen|verde|zelen)/i, "Green"],
  [/^(yellow|gelb|geel|giallo|amarelo|amarillo|zlt[aay]|zlut[aay]|zhult)/i, "Yellow"],
  [/^(orange|oran[zž])/i, "Orange"],
  [/^(brown|braun|bruin|marrone|marrom|marron|hned[aay]|kafyav)/i, "Brown"],
  [/^(beige|bezov|bezov[aay]|béž)/i, "Beige"],
  [/^(gold|zlat[aay]|oro)/i, "Gold"],
  [/^(purple|violet|lila|fialov|paars|viola)/i, "Purple"],
  [/^(pink|rosa|ruzov|ružov)/i, "Pink"],
];

const BODY_MAP: Array<[RegExp, string]> = [
  [/\bsuv\b|off[\s-]?road|gelande|teren|джип/i, "SUV"],
  [/\b(kombi|estate|wagon|station\s*wagon|break|touring|универсал)\b/i, "Wagon"],
  [/\b(kompaktn[eé]\s*mpv|mpv|minivan|monospace)\b/i, "MPV"],
  [/\b(hatch|hatchback|kleinwagen|compact\s*car|kompakt)\b/i, "Hatchback"],
  [/\b(sedan|limousine|berline|saloon|седан)\b/i, "Sedan"],
  [/\b(van|transporter|dodavka|dodávka|uzitkov|užitkov|furgone|bestel|bedrijfswagen)\b/i, "Van"],
  [/\b(pickup|pick[\s-]?up|valnik|valník)\b/i, "Pickup"],
  [/\b(cabrio|cabriolet|convertible|roadster|spider|spyder)\b/i, "Convertible"],
  [/\b(coupe|coupé|kup[eé])\b/i, "Coupe"],
  [/\b(bus|minibus)\b/i, "Bus"],
  [/\b(osobni|osobní|passenger)\b/i, "Passenger"],
  [/\b(nakladni|nákladní|truck|camion)\b/i, "Truck"],
  [/\b(obytne|obytné|motorhome|camper|caravan)\b/i, "Motorhome"],
  [/\b(motorky|motorcycle|moto)\b/i, "Motorcycle"],
];

const FUEL_MAP: Array<[RegExp, string]> = [
  [/diesel|nafta|gasolio|gasóleo|дизел/i, "Diesel"],
  [/benz[ií]n|petrol|gasoline|gasolina|benzin|essence|бензин/i, "Gasoline"],
  [/plug.?in|phev/i, "Plug-in Hybrid"],
  [/hybrid/i, "Hybrid"],
  [/elektro|electric|ev\b|elektr|електр/i, "Electric"],
  [/lpg|autogas|gpl|plyn/i, "LPG"],
  [/cng|erdgas|metano|zemní\s*plyn|zemny\s*plyn/i, "CNG"],
  [/hydrogen|wasserstoff|vodík|vodik/i, "Hydrogen"],
];

const TRANS_MAP: Array<[RegExp, string]> = [
  [/auto|automat|cvt|dsg|edc|tiptronic|převodovka\s*automat|prevodovka\s*automat/i, "Automatic"],
  [/manu|Schalt|schakel|manuale|meccanica|ръчн/i, "Manual"],
];

/** Exact / phrase event translations (SK/CS first — highest volume today). */
const EVENT_EXACT: Record<string, string> = {
  "servisná knižka": "Service book",
  "servisni knizka": "Service book",
  "servisní knížka": "Service book",
  "kúpené nové v sr": "Bought new in Slovakia",
  "kupene nove v sr": "Bought new in Slovakia",
  "koupené nové v čr": "Bought new in Czechia",
  "koupené nové v cr": "Bought new in Czechia",
  "po prvom majiteľovi": "One previous owner",
  "po prvom majitelovi": "One previous owner",
  "po prvním majiteli": "One previous owner",
  "predvádzacie vozidlo": "Demo vehicle",
  "predvadzacie vozidlo": "Demo vehicle",
  "předváděcí vůz": "Demo vehicle",
  "predvadecí vuz": "Demo vehicle",
  "nové vozidlo": "New vehicle",
  "nove vozidlo": "New vehicle",
  "havarované": "Accident damage",
  "havarovane": "Accident damage",
  "nehavarované": "No accident damage",
  "nehavarovane": "No accident damage",
  "servisováno v autorizovaném servisu": "Serviced at authorized dealer",
  "servisovane v autorizovanom servise": "Serviced at authorized dealer",
};

const EVENT_PATTERNS: Array<[RegExp, string | ((m: RegExpMatchArray) => string)]> = [
  [/^servisn[aá]\s+kni[žz]ka$/i, "Service book"],
  [/^k[uú]pen[eé]\s+nov[eé]\s+v\s+sr$/i, "Bought new in Slovakia"],
  [/^koupen[eé]\s+nov[eé]\s+v\s+č?r$/i, "Bought new in Czechia"],
  [/^po\s+prvom?\s+majitel/i, "One previous owner"],
  [/^predv[aá]dzacie\s+vozidlo$/i, "Demo vehicle"],
  [/^předváděcí\s+vůz$/i, "Demo vehicle"],
  [/^stk\s*\/\s*technical control valid until\s+(\d{4}-\d{2}-\d{2})$/i, (m) => `Technical inspection valid until ${m[1]}`],
  [/^factory warranty until$/i, "Factory warranty until"],
  [/^last service book entry$/i, "Last service book entry"],
  [/^first registration\s+/i, (m) => m[0].replace(/^first registration/i, "First registration")],
];

function mapFirst(raw: string | undefined | null, rules: Array<[RegExp, string]>): string | undefined {
  if (!raw?.trim()) return undefined;
  const t = raw.trim();
  for (const [re, en] of rules) {
    if (re.test(t) || re.test(fold(t))) return en;
  }
  return t;
}

export function normalizeEuColor(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  const t = raw.trim();
  for (const [re, en] of COLOR_MAP) {
    if (re.test(t) || re.test(fold(t))) return en;
  }
  // Already English-looking single word — title-case.
  if (/^[A-Za-z]+$/.test(t)) return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  return t;
}

export function normalizeEuBodyType(raw?: string | null): string | undefined {
  return mapFirst(raw, BODY_MAP);
}

export function normalizeEuFuel(raw?: string | null): string | undefined {
  return mapFirst(raw, FUEL_MAP);
}

export function normalizeEuTransmission(raw?: string | null): string | undefined {
  return mapFirst(raw, TRANS_MAP);
}

export function translateEuEventDescription(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  const t = raw.trim();
  const folded = fold(t);
  const exact = EVENT_EXACT[folded] ?? EVENT_EXACT[t.toLowerCase()];
  if (exact) return exact;
  for (const [re, out] of EVENT_PATTERNS) {
    const m = t.match(re) || folded.match(re);
    if (!m) continue;
    return typeof out === "function" ? out(m) : out;
  }
  // Slovak/Czech diacritic-heavy leftovers: keep known English stubs as-is.
  if (/^[A-Za-z0-9 ,./\-–—:]+$/.test(t)) return t;
  return t;
}

export function translateEuHistoryLabel(label: string): {
  eventType: "inspection" | "delivery" | "accident" | "owner_change" | "sale" | "other";
  description: string;
} {
  const lower = fold(label);
  let eventType: "inspection" | "delivery" | "accident" | "owner_change" | "sale" | "other" = "other";
  // Undated history chips ("Bought new in SK", demo, etc.) must NOT be delivery —
  // delivery is reserved for real first-registration dates (else UI shows crawl year).
  if (/servis|service|knizk|kniha|stk|technical|inspection/i.test(lower)) eventType = "inspection";
  else if (/havar|accident|posko|damage|crash/i.test(lower)) eventType = "accident";
  else if (/majitel|owner|vlastnik|previous owner|prvy majitel|first.?owner/i.test(lower)) {
    eventType = "owner_change";
  } else if (/predaj|sold|sale/i.test(lower)) eventType = "sale";
  else if (/nov|new|kupen|koupen|bought new|demo|predvad/i.test(lower)) eventType = "other";
  return {
    eventType,
    description: translateEuEventDescription(label) ?? label,
  };
}
