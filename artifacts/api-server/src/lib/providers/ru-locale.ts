/**
 * Normalize Russian / Belarusian marketplace vehicle strings to English.
 * Used by NFS Auto, Auto Partner, and pipeline sanitize (reject Cyrillic junk).
 */

import { normalizeFuelType } from "../fuel-normalize";

const PLACEHOLDER = /^(0+|n\/?a|null|undefined|unknown|unspecified|not\s*specified|none|other|others|-|—|–|\.|--+)$/i;

/** Polluted when fieldAfter slurped the rest of the page after a RU label. */
export function isPollutedSpec(raw?: string | null): boolean {
  if (!raw) return true;
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t || PLACEHOLDER.test(t)) return true;
  if (t.length > 48) return true;
  if (/Цена|объявлен|Доставка|справедлив|Бренды|База знаний|Инструменты|Настройк|под ключ/i.test(t)) {
    return true;
  }
  // More than one distinct RU field label → concatenated garbage.
  const labels = t.match(
    /Топливо|Привод|Коробка|Трансмиссия|Пробег|Модель|Марка|Двигатель|Цвет|Кузов/gi,
  );
  return (labels?.length ?? 0) >= 2;
}

const RU_MONTHS: Record<string, number> = {
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
  янв: 1,
  фев: 2,
  мар: 3,
  апр: 4,
  май: 5,
  июн: 6,
  июл: 7,
  авг: 8,
  сен: 9,
  окт: 10,
  ноя: 11,
  дек: 12,
};

/** `18 августа 2026` / `Июль, 2024 год` → Date (UTC noon). */
export function parseRuDisplayDate(raw?: string | null): Date | undefined {
  if (!raw?.trim()) return undefined;
  const t = raw.replace(/\s+/g, " ").trim();

  const full = t.match(/(\d{1,2})\s+([А-Яа-яЁё]+)\s+(\d{4})/);
  if (full) {
    const day = Number(full[1]);
    const month = RU_MONTHS[full[2]!.toLowerCase()];
    const year = Number(full[3]);
    if (month && day >= 1 && day <= 31 && year >= 1990 && year <= 2100) {
      return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    }
  }

  const monthYear = t.match(/([А-Яа-яЁё]+)\s*,?\s*(\d{4})\s*(?:год|г\.?)?/i);
  if (monthYear) {
    const month = RU_MONTHS[monthYear[1]!.toLowerCase()];
    const year = Number(monthYear[2]);
    if (month && year >= 1990 && year <= 2100) {
      return new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
    }
  }

  const dotted = t.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    const year = Number(dotted[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1990) {
      return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    }
  }
  return undefined;
}

export function normalizeRuFuel(raw?: string | null): string | undefined {
  if (isPollutedSpec(raw)) return undefined;
  const t = raw!.replace(/\s+/g, " ").trim();
  const canonical = normalizeFuelType(t);
  if (canonical) return canonical;
  if (/пропан|propan/i.test(t)) return "LPG";
  if (/гибрид|hybrid/i.test(t)) return "Hybrid";
  if (/бензин|gasoline|petrol/i.test(t)) return "Gasoline";
  if (/дизел|diesel/i.test(t)) return "Diesel";
  if (/электр|electric/i.test(t)) return "Electric";
  if (/газ|lpg|gpl/i.test(t)) return "LPG";
  if (/водород|hydrogen/i.test(t)) return "Hydrogen";
  if (/^[A-Za-z][A-Za-z0-9+ /\-]{1,30}$/.test(t)) return t;
  return undefined;
}

export function normalizeRuDrive(raw?: string | null): string | undefined {
  if (isPollutedSpec(raw)) return undefined;
  const t = raw!.replace(/\s+/g, " ").trim();
  if (/полн|awd|4\s*wd|4x4|all[\s-]?wheel|4matic|xdrive|quattro/i.test(t)) return "AWD";
  if (/передн|fwd|front|2\s*wd|2wd/i.test(t)) return "FWD";
  if (/задн|rwd|rear/i.test(t)) return "RWD";
  if (/^(FWD|RWD|AWD|4WD|2WD)$/i.test(t)) return t.toUpperCase().replace("4WD", "AWD").replace("2WD", "FWD");
  return undefined;
}

export function normalizeRuTransmission(raw?: string | null): string | undefined {
  if (isPollutedSpec(raw)) return undefined;
  const t = raw!.replace(/\s+/g, " ").trim();
  if (/авт|акпп|акп\b|cvt|dsg|tiptronic|automatic|робот|вариатор/i.test(t)) return "Automatic";
  if (/механ|мкпп|мкп\b|manual|ручн/i.test(t)) return "Manual";
  if (/^(Automatic|Manual|CVT|DCT)$/i.test(t)) {
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  }
  return undefined;
}

export function normalizeRuColor(raw?: string | null): string | undefined {
  if (isPollutedSpec(raw)) return undefined;
  const t = raw!.replace(/\s+/g, " ").trim();
  const rules: Array<[RegExp, string]> = [
    [/бел|white/i, "White"],
    [/чёрн|черн|black/i, "Black"],
    [/сер(ый|ая|ое)|grey|gray|dark\s*gray|т[её]мн/i, "Grey"],
    [/серебр|silver/i, "Silver"],
    [/син|blue|голуб/i, "Blue"],
    [/красн|red|бордо/i, "Red"],
    [/зел[её]н|green/i, "Green"],
    [/ж[её]лт|yellow/i, "Yellow"],
    [/оранж|orange/i, "Orange"],
    [/коричн|brown/i, "Brown"],
    [/бежев|beige/i, "Beige"],
    [/золот|gold/i, "Gold"],
    [/фиолет|пурпур|purple/i, "Purple"],
    [/розов|pink/i, "Pink"],
  ];
  for (const [re, en] of rules) if (re.test(t)) return en;
  if (/^[A-Za-z][A-Za-z\s-]{1,30}$/.test(t)) {
    return t.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return undefined;
}

export function normalizeRuBody(raw?: string | null): string | undefined {
  if (isPollutedSpec(raw)) return undefined;
  const t = raw!.replace(/\s+/g, " ").trim();
  const rules: Array<[RegExp, string]> = [
    [/внедорож|кроссовер|suv|джип/i, "SUV"],
    [/седан|sedan/i, "Sedan"],
    [/хэтч|хетч|hatch/i, "Hatchback"],
    [/универсал|wagon|estate/i, "Wagon"],
    [/купе|coupe|coupé/i, "Coupe"],
    [/кабрио|convertible/i, "Convertible"],
    [/минив[еэ]н|mpv|minivan/i, "MPV"],
    [/пикап|pickup/i, "Pickup"],
    [/фургон|van/i, "Van"],
    [/средн/i, "Sedan"],
  ];
  for (const [re, en] of rules) if (re.test(t)) return en;
  if (/^[A-Za-z][A-Za-z0-9\s-]{1,30}$/.test(t)) return t;
  return undefined;
}

/** Drop Cyrillic / polluted leftovers; keep English enums only. */
export function englishOnlySpec(raw?: string | null): string | undefined {
  if (!raw?.trim() || isPollutedSpec(raw)) return undefined;
  const t = raw.replace(/\s+/g, " ").trim();
  if (/[А-Яа-яЁё]/.test(t)) return undefined;
  return t;
}
