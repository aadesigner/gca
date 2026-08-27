/**
 * Encar Korean → English normalization.
 * Encar's readside API has English make/model but Korean specs and addresses only.
 */

import { forceEnglish, translateEncarMake } from "./encar-catalog";
import { SOUTH_KOREA, withCountry } from "../geo";

const FUEL_BY_CD: Record<string, string> = {
  "001": "Gasoline",
  "002": "Diesel",
  "003": "LPG",
  "004": "Hybrid",
  "005": "Hybrid",
  "006": "Hybrid",
  "007": "Hybrid",
  "008": "Electric",
  "009": "Electric",
};

const FUEL_BY_NAME: Record<string, string> = {
  가솔린: "Gasoline",
  디젤: "Diesel",
  전기: "Electric",
  "가솔린+전기": "Hybrid",
  "디젤+전기": "Hybrid",
  하이브리드: "Hybrid",
  "LPG(일반인 구입)": "LPG",
  LPG: "LPG",
};

const BODY_BY_NAME: Record<string, string> = {
  경차: "Mini",
  소형차: "Compact",
  준중형차: "Subcompact",
  중형차: "Mid-size",
  대형차: "Full-size",
  SUV: "SUV",
  RV: "RV",
  승합차: "Van",
  화물차: "Truck",
  스포츠카: "Sports Car",
  쿠페: "Coupe",
  해치백: "Hatchback",
  세단: "Sedan",
  왜건: "Wagon",
  픽업: "Pickup",
};

const TRANSMISSION_BY_NAME: Record<string, string> = {
  오토: "Automatic",
  자동: "Automatic",
  자동변속: "Automatic",
  수동: "Manual",
  수동변속: "Manual",
  CVT: "CVT",
  DCT: "DCT",
  무단변속: "CVT",
};

const COLOR_BY_NAME: Record<string, string> = {
  검정색: "Black",
  흑색: "Black",
  흰색: "White",
  은색: "Silver",
  명은색: "Silver",
  회색: "Gray",
  쥐색: "Gray",
  빨간색: "Red",
  주황색: "Orange",
  노란색: "Yellow",
  녹색: "Green",
  초록색: "Green",
  파란색: "Blue",
  청색: "Blue",
  하늘색: "Sky Blue",
  연하늘색: "Light Sky Blue",
  청옥색: "Turquoise",
  보라색: "Purple",
  갈색: "Brown",
  베이지색: "Beige",
  금색: "Gold",
  와인색: "Burgundy",
  분홍색: "Pink",
};

/** Province / city / district tokens seen in Encar dealer addresses. */
const PLACE_BY_NAME: Record<string, string> = {
  서울: "Seoul",
  부산: "Busan",
  대구: "Daegu",
  인천: "Incheon",
  광주: "Gwangju",
  대전: "Daejeon",
  울산: "Ulsan",
  세종: "Sejong",
  경기: "Gyeonggi",
  강원: "Gangwon",
  충북: "North Chungcheong",
  충남: "South Chungcheong",
  전북: "North Jeolla",
  전남: "South Jeolla",
  경북: "North Gyeongsang",
  경남: "South Gyeongsang",
  제주: "Jeju",
  강남구: "Gangnam-gu",
  강북구: "Gangbuk-gu",
  강서구: "Gangseo-gu",
  강동구: "Gangdong-gu",
  서초구: "Seocho-gu",
  송파구: "Songpa-gu",
  마포구: "Mapo-gu",
  영등포구: "Yeongdeungpo-gu",
  종로구: "Jongno-gu",
  중구: "Jung-gu",
  용산구: "Yongsan-gu",
  성동구: "Seongdong-gu",
  광진구: "Gwangjin-gu",
  동대문구: "Dongdaemun-gu",
  중랑구: "Jungnang-gu",
  성북구: "Seongbuk-gu",
  도봉구: "Dobong-gu",
  노원구: "Nowon-gu",
  은평구: "Eunpyeong-gu",
  서대문구: "Seodaemun-gu",
  양천구: "Yangcheon-gu",
  구로구: "Guro-gu",
  금천구: "Geumcheon-gu",
  동작구: "Dongjak-gu",
  관악구: "Gwanak-gu",
  김포시: "Gimpo",
  안산시: "Ansan",
  수원시: "Suwon",
  성남시: "Seongnam",
  고양시: "Goyang",
  용인시: "Yongin",
  부천시: "Bucheon",
  화성시: "Hwaseong",
  파주시: "Paju",
  의정부시: "Uijeongbu",
  단원구: "Danwon-gu",
  상록구: "Sangnok-gu",
};

const STREET_TOKEN = /(?:로|길)\d*|\d{2,}/;

export function containsHangul(value: string): boolean {
  return /[\uAC00-\uD7AF]/.test(value);
}

function mapLookup(map: Record<string, string>, raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (map[trimmed]) return map[trimmed];
  if (!containsHangul(trimmed)) return trimmed;
  return undefined;
}

export function normalizeEncarFuel(spec: {
  fuelCd?: string | null;
  fuelName?: string | null;
}): string | undefined {
  if (spec.fuelCd && FUEL_BY_CD[spec.fuelCd]) return FUEL_BY_CD[spec.fuelCd];
  const byName = mapLookup(FUEL_BY_NAME, spec.fuelName);
  if (byName) return byName;
  const name = spec.fuelName?.trim();
  if (!name) return undefined;
  if (name.includes("가솔린") && name.includes("전기")) return "Hybrid";
  if (name.includes("디젤") && name.includes("전기")) return "Hybrid";
  if (name.includes("전기")) return "Electric";
  if (name.includes("LPG")) return "LPG";
  if (name.includes("가솔린")) return "Gasoline";
  if (name.includes("디젤")) return "Diesel";
  return containsHangul(name) ? undefined : name;
}

export function normalizeEncarTransmission(raw?: string | null): string | undefined {
  return (
    mapLookup(TRANSMISSION_BY_NAME, raw) ??
    (raw && !containsHangul(raw) ? raw.trim() : undefined)
  );
}

export function normalizeEncarBody(raw?: string | null): string | undefined {
  return mapLookup(BODY_BY_NAME, raw) ?? (raw && !containsHangul(raw) ? raw.trim() : undefined);
}

export function normalizeEncarColor(raw?: string | null): string | undefined {
  return mapLookup(COLOR_BY_NAME, raw) ?? (raw && !containsHangul(raw) ? raw.trim() : undefined);
}

/** City/region only — strips Korean street addresses down to English place names, then tags South Korea. */
export function normalizeEncarLocation(raw?: string | null): string | undefined {
  if (!raw?.trim()) return SOUTH_KOREA;
  const trimmed = raw.trim();
  if (!containsHangul(trimmed)) return withCountry(trimmed, SOUTH_KOREA);

  const parts: string[] = [];
  for (const token of trimmed.split(/\s+/)) {
    if (STREET_TOKEN.test(token)) break;

    const mapped = PLACE_BY_NAME[token];
    if (mapped) {
      parts.push(mapped);
      continue;
    }

    if (parts.length >= 3) break;
  }

  return withCountry(parts.length > 0 ? parts.join(", ") : undefined, SOUTH_KOREA);
}

const PANEL_BY_NAME: Record<string, string> = {
  FRONT_DOOR_LEFT: "Front Door (Left)",
  FRONT_DOOR_RIGHT: "Front Door (Right)",
  BACK_DOOR_LEFT: "Rear Door (Left)",
  BACK_DOOR_RIGHT: "Rear Door (Right)",
  TRUNK_LID: "Trunk Lid",
  HOOD: "Hood",
  FRONT_FENDER_LEFT: "Front Fender (Left)",
  FRONT_FENDER_RIGHT: "Front Fender (Right)",
  CHECKER_COMMENT: "Diagnosis Summary",
  OUTER_PANEL_COMMENT: "Outer Panel Notes",
};

const DIAGNOSIS_RESULT_BY_CODE: Record<string, string> = {
  NORMAL: "Normal",
  REPLACEMENT: "Replacement",
  REPAIR: "Repair",
  SCRATCH: "Scratch",
  DENT: "Dent",
};

const INSPECTION_STATUS_BY_NAME: Record<string, string> = {
  양호: "Good",
  불량: "Defective",
  없음: "None",
  정상: "Normal",
  교환: "Replacement",
  판금: "Panel repair",
  도장: "Repaint",
  부식: "Corrosion",
  미세누유: "Minor leak",
  누유: "Leak",
};

const INSPECTION_PANEL_BY_NAME: Record<string, string> = {
  휀더: "Fender",
  쿼터패널: "Quarter panel",
  "1/4패널": "Quarter panel",
  도어: "Door",
  트렁크: "Trunk lid",
  후드: "Hood",
  라디에이터서포트: "Radiator support",
  "라디에이터 서포트": "Radiator support",
  크로스멤버: "Cross member",
  "크로스 멤버": "Cross member",
  인사이드패널: "Inside panel",
  "인사이드 패널": "Inside panel",
  필러: "Pillar",
  "A필러": "A-pillar",
  "B필러": "B-pillar",
  "C필러": "C-pillar",
  "프론트 패널": "Front panel",
  "리어 패널": "Rear panel",
  "사이드실": "Side sill",
  "루프": "Roof",
  "범퍼": "Bumper",
  "프론트 범퍼": "Front bumper",
  "리어 범퍼": "Rear bumper",
};

const SIDE_PREFIX: Record<string, string> = {
  전: "Front",
  후: "Rear",
  좌: "Left",
  조: "Left",
  우: "Right",
  양: "Both sides",
  운: "Rear",
};

const COMMENT_PHRASES: Array<[RegExp, string]> = [
  [/본\s*차량은\s*엔카(?:의)?\s*진단\s*결과\s*모든\s*항목(?:이)?\s*정상(?:이며)?[,.]?\s*['']?무사고['']?\s*차량\s*판정(?:입니다)?/gi, "Encar diagnosis: all items normal. Classified as a no-accident vehicle."],
  [/본\s*차량은\s*엔카(?:의)?\s*진단\s*결과\s*외부\s*패널\s*교환\s*차량입니다/gi, "Encar diagnosis: classified as an outer-panel replacement vehicle."],
  [/엔카(?:의)?\s*진단\s*결과\s*외부\s*패널\s*교환\s*차량/gi, "Encar diagnosis: outer-panel replacement vehicle"],
  [/외부\s*패널\s*교환\s*차량입니다/gi, "This is an outer-panel replacement vehicle."],
  [/외부\s*패널\s*교환\s*차량/gi, "outer-panel replacement vehicle"],
  [/\(\s*FRP\s*\)\s*판금\s*및\s*도장(?:된)?\s*차량입니다/gi, "FRP panel was repaired and repainted."],
  [/\(\s*FRP\s*\)\s*판금\s*및\s*차량/gi, "FRP panel repair"],
  [/\(\s*FRP\s*\)\s*판금/gi, "FRP panel repair"],
  [/내차보험/g, "Own insurance"],
  [/상대차보험/g, "Third-party insurance"],
  [/내차피해/g, "Own-vehicle damage"],
  [/상대차피해/g, "Third-party damage"],
  [/본\s*차량은\s*엔카의\s*진단\s*결과/gi, "This vehicle's Encar diagnosis shows"],
  [/엔카\s*진단\s*결과/gi, "Encar diagnosis"],
  [/국토부정비이력있음/g, "Ministry maintenance history present"],
  [/국토부\s*정비\s*이력\s*있음/g, "Ministry maintenance history present"],
  [/외부패널/g, "outer panel"],
  [/단순교환/g, "outer panel replacement only"],
  [/주요\s*골격/g, "main structure"],
  [/프레임/g, "frame"],
  [/무사고/g, "no accident"],
  [/정상/g, "normal"],
  [/교환/g, "replacement"],
  [/판금/g, "panel repair"],
  [/도장/g, "repaint"],
  [/퍼티/g, "putty filler"],
  [/손상/g, "damage"],
  [/정비이력/g, "maintenance history"],
  [/확인\s*결과/g, "inspection confirms"],
  [/상세\s*진단\s*결과/g, "detailed diagnosis"],
  [/진단\s*판정/g, "diagnosis classification"],
  [/모든\s*항목/g, "all items"],
  [/관련된/g, "related"],
  [/둘러싼/g, "surrounding"],
  [/둘러쌓은/g, "surrounding"],
  [/부위/g, "section"],
  [/부의/g, " section "],
  [/차량/g, "vehicle"],
  [/및/g, " and "],
  [/이\s*없음을\s*확인/g, "none were confirmed"],
  [/없음을\s*확인/g, "none were confirmed"],
  [/확인\s*하였습니다/g, "was confirmed"],
  [/확인\s*하였습니다/g, "was confirmed"],
  [/확인되어/g, "confirmed as"],
  [/되었으며/g, ", and"],
  [/되었음을/g, " was"],
  [/되었/g, " was"],
  [/합니다/g, "."],
  [/합니다\./g, "."],
  [/뒷문\s*\(\s*좌\s*\)/g, "rear door (left)"],
  [/뒷문\s*\(\s*우\s*\)/g, "rear door (right)"],
  [/앞문\s*\(\s*좌\s*\)/g, "front door (left)"],
  [/앞문\s*\(\s*우\s*\)/g, "front door (right)"],
  [/앞\s*도어\s*\(\s*좌\s*\)/g, "front door (left)"],
  [/앞\s*도어\s*\(\s*우\s*\)/g, "front door (right)"],
  [/뒤\s*도어\s*\(\s*좌\s*\)/g, "rear door (left)"],
  [/뒤\s*도어\s*\(\s*우\s*\)/g, "rear door (right)"],
];

const COMMENT_WORDS: Record<string, string> = {
  가: "",
  이: "",
  을: "",
  를: "",
  은: "",
  는: "",
  으로: "",
  에: "",
  의: "",
  과: "",
  와: "",
  도: "",
  만: "",
  에서: "",
  으로서: "",
  확인: "confirmed",
  결과: "result",
  항목: "item",
  모든: "all",
  관련: "related",
  없음: "none",
  있음: "present",
  판정: "classification",
  진단: "diagnosis",
  차량: "vehicle",
  휀더: "fender",
  쿼터패널: "quarter panel",
  퍼티: "putty filler",
  손상: "damage",
  도장: "repaint",
  판금: "panel repair",
};

export function normalizeEncarMaker(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  return translateEncarMake(raw) ?? (containsHangul(raw) ? undefined : raw.trim());
}

export function normalizeEncarDiagnosisPanel(raw?: string | null): string {
  if (!raw) return "Unknown panel";
  return PANEL_BY_NAME[raw] ?? raw.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function normalizeEncarDiagnosisResult(code?: string | null, raw?: string | null): string {
  if (code && DIAGNOSIS_RESULT_BY_CODE[code]) return DIAGNOSIS_RESULT_BY_CODE[code];
  return mapLookup(INSPECTION_STATUS_BY_NAME, raw) ?? raw ?? "Unknown";
}

export function normalizeEncarInspectionStatus(raw?: string | null): string | undefined {
  return mapLookup(INSPECTION_STATUS_BY_NAME, raw) ?? (raw && !containsHangul(raw) ? raw : undefined);
}

/** Translate Korean inspection panel labels like "(조)휀더". */
export function translateEncarInspectionPanel(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  let text = raw.trim();
  if (!containsHangul(text)) return text;

  text = text.replace(/\(([전후좌우조양운])\)/g, (_, side: string) => {
    const label = SIDE_PREFIX[side];
    return label ? `(${label})` : "";
  });

  for (const [ko, en] of Object.entries(INSPECTION_PANEL_BY_NAME)) {
    text = text.replace(new RegExp(ko, "g"), en);
  }

  for (const [pattern, replacement] of COMMENT_PHRASES) {
    text = text.replace(pattern, replacement);
  }

  return cleanupTranslatedText(text);
}

function polishEnglishInspectionProse(text: string): string {
  return text
    .replace(
      /This vehicle's Encar diagnosis shows all items normal,\s*'no accident' vehicle classification\.?/gi,
      "Encar diagnosis: all items normal. Classified as a no-accident vehicle.",
    )
    .replace(
      /vehicle diagnosis result outer panel replacement vehicle/gi,
      "Encar diagnosis: classified as an outer-panel replacement vehicle",
    )
    .replace(/\(\s*FRP\s*\)\s*panel repair,?\s*and\s*vehicle\.*/gi, "FRP panel was repaired.")
    .replace(/\bvehicle diagnosis result\b/gi, "Encar diagnosis")
    .replace(/\band vehicle\.+/gi, ".")
    .replace(/\bvehicle\s+vehicle\b/gi, "vehicle")
    .replace(/\s+\./g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanupTranslatedText(text: string): string {
  let out = text
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/\)([A-Za-z])/g, ") $1")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/(replacement)(none)/gi, "$1 $2")
    .replace(/(filler)(repaint)/gi, "$1 / $2")
    .replace(/(panel)(repaint)/gi, "$1 $2")
    .replace(/\s+([)\]])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\b(\w+(?: \w+)*)\s+\1\b/gi, "$1")
    .replace(/\.\s*\./g, ".")
    .trim();

  if (containsHangul(out)) {
    out = out.replace(/[\uAC00-\uD7AF]+/g, (word) => COMMENT_WORDS[word] ?? "");
    out = out.replace(/[\uAC00-\uD7AF]/g, "");
  }

  return polishEnglishInspectionProse(
    out.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim(),
  );
}

/** Best-effort English rendering for free-text Korean comments. */
export function translateEncarComment(raw?: string | null): string | undefined {
  return translateEncarText(raw);
}

/** Translate any Encar free-text field to English. */
export function translateEncarText(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  let text = raw.trim();
  if (containsHangul(text)) {
    for (const [pattern, replacement] of COMMENT_PHRASES) {
      text = text.replace(pattern, replacement);
    }

    for (const [ko, en] of Object.entries(INSPECTION_PANEL_BY_NAME)) {
      text = text.replace(new RegExp(ko, "g"), en);
    }

    text = text.replace(/\(([전후좌우조양운])\)/g, (_, side: string) => {
      const label = SIDE_PREFIX[side];
      return label ? `(${label})` : "";
    });

    text = cleanupTranslatedText(text);
  }
  return polishEnglishInspectionProse(text);
}

/** Normalize stored/served event descriptions to English. */
export function translateEncarEventDescription(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  const translated = translateEncarText(raw);
  if (!translated) return undefined;
  return forceEnglish(containsHangul(translated) ? cleanupTranslatedText(translated) : translated);
}

/** Recursively translate Encar JSON blobs so the UI never shows Hangul. */
export function englishizeEncarJson<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") {
    return (translateEncarText(value) ?? forceEnglish(value) ?? value) as T;
  }
  if (Array.isArray(value)) return value.map((item) => englishizeEncarJson(item)) as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = englishizeEncarJson(child);
    }
    return out as T;
  }
  return value;
}

export function normalizeEncarTextField(
  field: "fuelType" | "transmission" | "bodyType" | "color",
  value?: string | null,
): string | undefined {
  if (!value?.trim()) return undefined;
  switch (field) {
    case "fuelType":
      return normalizeEncarFuel({ fuelName: value });
    case "transmission":
      return normalizeEncarTransmission(value);
    case "bodyType":
      return normalizeEncarBody(value);
    case "color":
      return normalizeEncarColor(value);
  }
}
