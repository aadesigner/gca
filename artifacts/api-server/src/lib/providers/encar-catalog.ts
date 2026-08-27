/**
 * Encar search tokens (Korean) ↔ English display names.
 * Live filters must send Encar tokens; JSON/UI must show English.
 */

const MAKE_KO_TO_EN: Record<string, string> = {
  벤츠: "Mercedes-Benz",
  아우디: "Audi",
  폭스바겐: "Volkswagen",
  볼보: "Volvo",
  포르쉐: "Porsche",
  랜드로버: "Land Rover",
  재규어: "Jaguar",
  미니: "Mini",
  포드: "Ford",
  토요타: "Toyota",
  도요타: "Toyota",
  렉서스: "Lexus",
  혼다: "Honda",
  닛산: "Nissan",
  인피니티: "Infiniti",
  마즈다: "Mazda",
  마쓰다: "Mazda",
  테슬라: "Tesla",
  제네시스: "Genesis",
  기아: "Kia",
  현대: "Hyundai",
  지프: "Jeep",
  링컨: "Lincoln",
  캐딜락: "Cadillac",
  쉐보레: "Chevrolet",
  크라이슬러: "Chrysler",
  닷지: "Dodge",
  람보르기니: "Lamborghini",
  롤스로이스: "Rolls-Royce",
  마세라티: "Maserati",
  페라리: "Ferrari",
  벤틀리: "Bentley",
  애스턴마틴: "Aston Martin",
  푸조: "Peugeot",
  시트로엥: "Citroen",
  폴스타: "Polestar",
  르노: "Renault",
  스바루: "Subaru",
  스즈키: "Suzuki",
  미쓰비시: "Mitsubishi",
  미쯔비시: "Mitsubishi",
  비엠더블유: "BMW",
  BMW: "BMW",
  르노코리아: "Renault",
  한국GM: "Chevrolet",
  쌍용: "KG Mobility",
  KG모빌리티: "KG Mobility",
  스마트: "Smart",
  마이바흐: "Maybach",
  맥라렌: "McLaren",
  알핀: "Alpine",
};

const MAKE_EN_TO_KO: Record<string, string> = Object.fromEntries(
  Object.entries(MAKE_KO_TO_EN).map(([ko, en]) => [en.toLowerCase(), ko]),
);
MAKE_EN_TO_KO.mercedes = "벤츠";
MAKE_EN_TO_KO["mercedes benz"] = "벤츠";
MAKE_EN_TO_KO.vw = "폭스바겐";
MAKE_EN_TO_KO.mini = "미니";
MAKE_EN_TO_KO.toyota = "도요타";

export const ENCAR_IMPORT_MAKES_EN = [
  "BMW",
  "Mercedes-Benz",
  "Audi",
  "Volkswagen",
  "Volvo",
  "Porsche",
  "Land Rover",
  "Jaguar",
  "Mini",
  "Tesla",
  "Lexus",
  "Toyota",
  "Honda",
  "Ford",
  "Jeep",
  "Lincoln",
  "Genesis",
  "Maserati",
  "Lamborghini",
  "Bentley",
  "Ferrari",
  "Peugeot",
  "Polestar",
  "BYD",
  "GMC",
];

export const ENCAR_DOMESTIC_MAKES_EN = [
  "Hyundai",
  "Kia",
  "Genesis",
  "Chevrolet",
  "KG Mobility",
  "Renault",
  "Samsung",
];

/** English model-group names sent as `modelGroup` (mapped to Encar tokens). */
export const ENCAR_MODELS_BY_MAKE: Record<string, string[]> = {
  BMW: ["1 Series", "2 Series", "3 Series", "4 Series", "5 Series", "6 Series", "7 Series", "8 Series", "X1", "X2", "X3", "X4", "X5", "X6", "X7", "XM", "Z4", "i3", "i4", "i5", "i7", "iX", "iX1", "iX2", "iX3"],
  "Mercedes-Benz": ["A-Class", "B-Class", "C-Class", "E-Class", "S-Class", "CLA", "CLE", "CLS", "GLA", "GLB", "GLC", "GLE", "GLS", "G-Class", "SL", "SLC", "AMG GT", "EQA", "EQB", "EQC", "EQE", "EQS", "Sprinter", "V-Class"],
  Audi: ["A1", "A3", "A4", "A5", "A6", "A7", "A8", "Q2", "Q3", "Q4", "Q5", "Q7", "Q8", "TT", "R8", "e-tron", "e-tron GT", "RS3", "RS4", "RS5", "RS6", "RS7"],
  Volkswagen: ["Golf", "Polo", "Passat", "Jetta", "Arteon", "Tiguan", "Touareg", "T-Roc", "T-Cross", "ID.3", "ID.4", "ID.5", "ID.Buzz", "Sharan", "Touran"],
  Volvo: ["S60", "S90", "V60", "V90", "XC40", "XC60", "XC90", "C40", "EX30", "EX90"],
  Porsche: ["911", "718", "Panamera", "Cayenne", "Macan", "Taycan"],
  "Land Rover": ["Range Rover", "Range Rover Sport", "Range Rover Velar", "Range Rover Evoque", "Defender", "Discovery", "Discovery Sport"],
  Jaguar: ["XE", "XF", "XJ", "F-Pace", "E-Pace", "I-Pace", "F-Type"],
  Mini: ["Cooper", "Clubman", "Countryman", "Convertible", "Paceman"],
  Tesla: ["Model 3", "Model Y", "Model S", "Model X"],
  Lexus: ["ES", "IS", "LS", "NX", "RX", "GX", "LX", "UX", "RC", "LC", "RZ"],
  Toyota: ["Camry", "Corolla", "Avalon", "Prius", "RAV4", "Highlander", "Land Cruiser", "Prado", "Hilux", "Sienna", "Alphard", "Vellfire", "bZ4X", "Crown"],
  Honda: ["Civic", "Accord", "CR-V", "HR-V", "Pilot", "Odyssey", "Fit"],
  Ford: ["Mustang", "Explorer", "Escape", "Edge", "F-150", "Ranger", "Bronco", "Expedition", "Territory"],
  Jeep: ["Wrangler", "Grand Cherokee", "Cherokee", "Compass", "Renegade", "Gladiator", "Avenger"],
  Lincoln: ["Aviator", "Corsair", "Nautilus", "Navigator", "MKZ"],
  Genesis: ["G70", "G80", "G90", "GV60", "GV70", "GV80", "Electrified G80", "Electrified GV70"],
  Hyundai: ["Avante", "Sonata", "Grandeur", "Tucson", "Santa Fe", "Palisade", "Kona", "Venue", "Ioniq 5", "Ioniq 6", "Ioniq 9", "Staria", "Casper", "Santa Cruz", "Nexo"],
  Kia: ["K3", "K5", "K8", "K9", "Morning", "Ray", "Seltos", "Sportage", "Sorento", "Carnival", "EV3", "EV6", "EV9", "Niro", "Mohave", "Tasman"],
  Chevrolet: ["Spark", "Malibu", "Trax", "Trailblazer", "Equinox", "Traverse", "Tahoe", "Colorado", "Camaro", "Bolt"],
  "KG Mobility": ["Tivoli", "Korando", "Rexton", "Torres", "Musso", "Actyon"],
  Renault: ["QM6", "SM6", "XM3", "Arkana", "Captur", "Megane", "Master"],
  Maserati: ["Ghibli", "Quattroporte", "Levante", "Grecale", "GranTurismo", "MC20"],
  Lamborghini: ["Huracan", "Urus", "Aventador", "Revuelto"],
  Bentley: ["Continental", "Flying Spur", "Bentayga"],
  Ferrari: ["Roma", "Portofino", "F8", "296", "SF90", "Purosangue", "812"],
  Peugeot: ["208", "308", "508", "2008", "3008", "5008"],
  Polestar: ["Polestar 2", "Polestar 3", "Polestar 4"],
  Cadillac: ["CT4", "CT5", "XT4", "XT5", "XT6", "Escalade", "Lyriq"],
  Infiniti: ["Q50", "Q60", "QX50", "QX55", "QX60", "QX80"],
  Nissan: ["Altima", "Maxima", "Rogue", "Murano", "Pathfinder", "Armada", "Leaf", "Ariya", "GT-R", "370Z"],
  Mazda: ["Mazda3", "Mazda6", "CX-3", "CX-30", "CX-5", "CX-50", "CX-60", "CX-90", "MX-5"],
  Subaru: ["Impreza", "Legacy", "Outback", "Forester", "Crosstrek", "Ascent", "BRZ"],
  BYD: ["Atto 3", "Seal", "Sealion 7", "Tang", "Han"],
  GMC: ["Sierra", "Yukon", "Terrain", "Canyon", "Hummer EV"],
};

export function encarModelsForMake(make?: string): string[] {
  if (!make?.trim()) return [];
  const exact = ENCAR_MODELS_BY_MAKE[make.trim()];
  if (exact) return exact;
  const key = Object.keys(ENCAR_MODELS_BY_MAKE).find(
    (name) => name.toLowerCase() === make.trim().toLowerCase(),
  );
  return key ? ENCAR_MODELS_BY_MAKE[key]! : [];
}

export function encarMakesForCarType(carType?: string): string[] {
  if (carType === "domestic") return [...ENCAR_DOMESTIC_MAKES_EN];
  if (carType === "all") {
    return [...new Set([...ENCAR_DOMESTIC_MAKES_EN, ...ENCAR_IMPORT_MAKES_EN])];
  }
  return [...ENCAR_IMPORT_MAKES_EN];
}

const FUEL_TO_ENCAR: Record<string, string> = {
  gasoline: "가솔린",
  petrol: "가솔린",
  gas: "가솔린",
  가솔린: "가솔린",
  diesel: "디젤",
  디젤: "디젤",
  electric: "전기",
  ev: "전기",
  전기: "전기",
  hybrid: "가솔린+전기",
  "가솔린+전기": "가솔린+전기",
  "디젤+전기": "디젤+전기",
  하이브리드: "가솔린+전기",
  lpg: "LPG",
};

const FUEL_TO_EN: Record<string, string> = {
  가솔린: "Gasoline",
  디젤: "Diesel",
  전기: "Electric",
  "가솔린+전기": "Hybrid",
  "디젤+전기": "Hybrid",
  하이브리드: "Hybrid",
  LPG: "LPG",
};

const TRANS_TO_ENCAR: Record<string, string> = {
  automatic: "오토",
  auto: "오토",
  오토: "오토",
  자동: "오토",
  manual: "수동",
  수동: "수동",
  cvt: "CVT",
  dct: "DCT",
};

const PLACE_EN_TO_KO: Record<string, string> = {
  seoul: "서울",
  busan: "부산",
  daegu: "대구",
  incheon: "인천",
  gwangju: "광주",
  daejeon: "대전",
  ulsan: "울산",
  sejong: "세종",
  gyeonggi: "경기",
  gangwon: "강원",
  jeju: "제주",
};

const MODEL_PHRASES: Array<[RegExp, string]> = [
  [/(\d)\s*시리즈/g, "$1 Series"],
  [/([A-Za-z])-클래스/g, "$1-Class"],
  [/클래스/g, "Class"],
  [/그란쿠페/g, "Gran Coupe"],
  [/액티브\s*투어러/g, "Active Tourer"],
  [/크로스컨트리/g, "Cross Country"],
  [/레인지로버/g, "Range Rover"],
  [/스포츠/g, "Sport"],
  [/세대/g, "Gen"],
  [/쿠퍼/g, "Cooper"],
  [/카이맨/g, "Cayman"],
  [/티구안/g, "Tiguan"],
  [/골프/g, "Golf"],
  [/모델\s*/g, "Model "],
  [/노틸러스/g, "Nautilus"],
  [/에비에이터/g, "Aviator"],
  [/시에라/g, "Sierra"],
  [/뉴\s+/g, "New "],
  [/쏘나타/g, "Sonata"],
  [/아반떼/g, "Avante"],
  [/그랜저/g, "Grandeur"],
  [/투싼/g, "Tucson"],
  [/싼타페/g, "Santa Fe"],
  [/카니발/g, "Carnival"],
  [/스포티지/g, "Sportage"],
  [/쏘렌토/g, "Sorento"],
  [/팰리세이드/g, "Palisade"],
  [/코나/g, "Kona"],
  [/아이오닉/g, "Ioniq"],
  [/EV6/g, "EV6"],
  [/포터/g, "Porter"],
  [/스타리아/g, "Staria"],
  [/베뉴/g, "Venue"],
  [/셀토스/g, "Seltos"],
  [/카니발/g, "Carnival"],
  [/모하비/g, "Mohave"],
  [/니로/g, "Niro"],
  [/레이/g, "Ray"],
  [/모닝/g, "Morning"],
  [/K5/g, "K5"],
  [/K8/g, "K8"],
  [/K9/g, "K9"],
  [/G70/g, "G70"],
  [/G80/g, "G80"],
  [/G90/g, "G90"],
  [/GV70/g, "GV70"],
  [/GV80/g, "GV80"],
  [/카렌스/g, "Carens"],
  [/렉스턴/g, "Rexton"],
  [/티볼리/g, "Tivoli"],
  [/코란도/g, "Korando"],
  [/QM6/g, "QM6"],
  [/SM6/g, "SM6"],
  [/볼트/g, "Bolt"],
  [/말리부/g, "Malibu"],
  [/트래버스/g, "Traverse"],
  [/이쿼녹스/g, "Equinox"],
  [/카마로/g, "Camaro"],
  [/머스탱/g, "Mustang"],
  [/익스플로러/g, "Explorer"],
  [/익스페디션/g, "Expedition"],
  [/랩터/g, "Raptor"],
  [/캠리/g, "Camry"],
  [/아발론/g, "Avalon"],
  [/프리우스/g, "Prius"],
  [/시에나/g, "Sienna"],
  [/하이랜더/g, "Highlander"],
  [/랜드크루저/g, "Land Cruiser"],
  [/어코드/g, "Accord"],
  [/시빅/g, "Civic"],
  [/파일럿/g, "Pilot"],
  [/오딧세이/g, "Odyssey"],
  [/알티마/g, "Altima"],
  [/맥시마/g, "Maxima"],
  [/로그/g, "Rogue"],
  [/패스파인더/g, "Pathfinder"],
  [/무스탕/g, "Mustang"],
  [/박스터/g, "Boxster"],
  [/파나메라/g, "Panamera"],
  [/카이엔/g, "Cayenne"],
  [/마칸/g, "Macan"],
  [/타이가/g, "Taycan"],
  [/911/g, "911"],
  [/A4/g, "A4"],
  [/A6/g, "A6"],
  [/A8/g, "A8"],
  [/Q5/g, "Q5"],
  [/Q7/g, "Q7"],
  [/Q8/g, "Q8"],
  [/X3/g, "X3"],
  [/X5/g, "X5"],
  [/X6/g, "X6"],
  [/X7/g, "X7"],
  [/3시리즈/g, "3 Series"],
  [/5시리즈/g, "5 Series"],
  [/7시리즈/g, "7 Series"],
  [/디스커버리/g, "Discovery"],
  [/디펜더/g, "Defender"],
  [/이보크/g, "Evoque"],
  [/벨라/g, "Velar"],
  [/클럽맨/g, "Clubman"],
  [/컨트리맨/g, "Countryman"],
  [/컨버터블/g, "Convertible"],
  [/왜건/g, "Wagon"],
  [/세단/g, "Sedan"],
  [/쿠페/g, "Coupe"],
  [/해치백/g, "Hatchback"],
  [/밴/g, "Van"],
  [/트럭/g, "Truck"],
  [/가솔린/g, "Gasoline"],
  [/디젤/g, "Diesel"],
  [/전기/g, "Electric"],
  [/하이브리드/g, "Hybrid"],
  [/오토/g, "Automatic"],
  [/수동/g, "Manual"],
  [/서울/g, "Seoul"],
  [/경기/g, "Gyeonggi"],
  [/부산/g, "Busan"],
  [/인천/g, "Incheon"],
  [/대구/g, "Daegu"],
  [/대전/g, "Daejeon"],
  [/광주/g, "Gwangju"],
  [/울산/g, "Ulsan"],
  [/강원/g, "Gangwon"],
  [/충북/g, "North Chungcheong"],
  [/충남/g, "South Chungcheong"],
  [/전북/g, "North Jeolla"],
  [/전남/g, "South Jeolla"],
  [/경북/g, "North Gyeongsang"],
  [/경남/g, "South Gyeongsang"],
  [/제주/g, "Jeju"],
];

const HANGUL = /[\uAC00-\uD7AF]+/g;

/** Translate Korean marketplace text and drop any leftover Hangul. */
export function forceEnglish(raw?: string | null): string | undefined {
  if (raw == null) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;

  let text = translateEncarMake(trimmed) ?? trimmed;
  text = translateEncarFuelName(text) ?? text;
  text = translateEncarModel(text) ?? text;
  text = text.replace(HANGUL, " ").replace(/\s{2,}/g, " ").replace(/\s+([,./()-])/g, "$1").trim();
  return text || undefined;
}

export function englishizeJson<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") return (forceEnglish(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((item) => englishizeJson(item)) as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = englishizeJson(child);
    }
    return out as T;
  }
  return value;
}

function normKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

export function isKnownManufacturer(raw?: string): boolean {
  if (!raw?.trim()) return false;
  const trimmed = raw.trim();
  if (MAKE_KO_TO_EN[trimmed]) return true;
  if (MAKE_EN_TO_KO[normKey(trimmed)]) return true;
  return /^(bmw|byd|gmc|mini|tesla|audi|volvo|porsche|jeep|ford|honda|lexus)$/i.test(trimmed);
}

export function encarSearchManufacturer(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const trimmed = raw.trim();
  if (MAKE_KO_TO_EN[trimmed]) return trimmed;
  const mapped = MAKE_EN_TO_KO[normKey(trimmed)];
  if (mapped) return mapped;
  return trimmed;
}

export function translateEncarMake(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  const trimmed = raw.trim();
  return MAKE_KO_TO_EN[trimmed] ?? trimmed;
}

export function translateEncarModel(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  let text = raw.trim();
  for (const [pattern, replacement] of MODEL_PHRASES) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s{2,}/g, " ").trim();
}

export function encarSearchFuel(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  return FUEL_TO_ENCAR[normKey(raw)] ?? FUEL_TO_ENCAR[raw.trim()] ?? raw.trim();
}

export function translateEncarFuelName(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  return FUEL_TO_EN[raw.trim()] ?? raw.trim();
}

export function encarSearchTransmission(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  return TRANS_TO_ENCAR[normKey(raw)] ?? raw.trim();
}

export function encarSearchLocation(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const trimmed = raw
    .trim()
    .replace(/,?\s*(south\s+)?korea$/i, "")
    .replace(/,?\s*\bKR\b$/i, "")
    .trim();
  if (!trimmed) return undefined;
  const full = PLACE_EN_TO_KO[normKey(trimmed)];
  if (full) return full;
  for (const part of trimmed.split(/[,\s]+/).filter(Boolean)) {
    const mapped = PLACE_EN_TO_KO[normKey(part)];
    if (mapped) return mapped;
  }
  return undefined;
}

export interface ParsedEncarSearch {
  make?: string;
  modelGroup?: string;
  model?: string;
  location?: string;
  year?: number;
}

/** Turn a free-text search into Encar manufacturer / model-group / year filters. */
export function parseEncarLiveSearch(raw?: string | null): ParsedEncarSearch {
  if (!raw?.trim()) return {};
  let q = raw.trim().replace(/\s+/g, " ");
  const out: ParsedEncarSearch = {};

  q = q.replace(/\b((?:19|20)\d{2})\b/g, (match) => {
    const year = Number(match);
    if (year >= 1990 && year <= 2028 && out.year == null) out.year = year;
    return " ";
  }).replace(/\s+/g, " ").trim();

  const makeCandidates = [
    ...ENCAR_IMPORT_MAKES_EN,
    "Mercedes",
    "Benz",
    "VW",
    "Chevy",
    "Chevrolet",
  ].sort((a, b) => b.length - a.length);

  for (const make of makeCandidates) {
    const pattern = new RegExp(
      `\\b${make.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[-\\s]+")}\\b`,
      "i",
    );
    if (!pattern.test(q)) continue;
    const canonical =
      /^mercedes$|^benz$/i.test(make) ? "Mercedes-Benz"
      : /^vw$/i.test(make) ? "Volkswagen"
      : /^chevy$/i.test(make) ? "Chevrolet"
      : ENCAR_IMPORT_MAKES_EN.find((m) => m.toLowerCase() === make.toLowerCase()) ?? make;
    out.make = canonical;
    q = q.replace(pattern, " ").replace(/\s+/g, " ").trim();
    break;
  }

  const series = q.match(/\b(\d)\s*-?\s*series\b/i);
  if (series) {
    out.modelGroup = `${series[1]} Series`;
    q = q.replace(series[0], " ").replace(/\s+/g, " ").trim();
  } else {
    const cls = q.match(/\b([A-Za-z])\s*-?\s*class\b/i);
    if (cls) {
      out.modelGroup = `${cls[1].toUpperCase()}-Class`;
      q = q.replace(cls[0], " ").replace(/\s+/g, " ").trim();
    }
  }

  if (!out.modelGroup) {
    const named = q.match(/\b(X[1-7]|iX|i[34578]|M[2-8]|GLE|GLC|GLS|GLA|GLB|CLA|CLS)\b/i);
    if (named) {
      out.modelGroup = named[1].toUpperCase().replace(/^IX$/i, "iX");
      q = q.replace(named[0], " ").replace(/\s+/g, " ").trim();
    }
  }

  const tokens = q ? q.split(" ") : [];
  const kept: string[] = [];
  for (const token of tokens) {
    const place = PLACE_EN_TO_KO[normKey(token)];
    if (place && !out.location) {
      out.location = token;
      continue;
    }
    kept.push(token);
  }
  const leftover = kept.join(" ").trim();
  if (leftover) {
    const compact = leftover.replace(/\s+/g, "");
    if (/^[A-Za-z]?\d{2,3}[A-Za-z]{0,4}$/.test(compact)) out.model = leftover;
    else if (!out.modelGroup && leftover.split(" ").length <= 3) out.modelGroup = leftover;
    else out.model = leftover;
  }
  if (out.model && !out.modelGroup) {
    const bmwTrim = out.model.match(/^(\d)\d{2}[A-Za-z]/i);
    if (bmwTrim) out.modelGroup = `${bmwTrim[1]} Series`;
    else {
      const mbTrim = out.model.match(/^([A-Za-z])\d{2,3}/i);
      if (mbTrim) out.modelGroup = `${mbTrim[1].toUpperCase()}-Class`;
    }
  }
  return out;
}

export function encarSearchModelGroup(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const s = raw.trim();
  const series = s.match(/^(\d)\s*series$/i);
  if (series) return `${series[1]}시리즈`;
  const cls = s.match(/^([A-Za-z])[-\s]?class$/i);
  if (cls) return `${cls[1].toUpperCase()}-클래스`;
  return s;
}

export function krwToEncarPriceMan(amount?: number): number | undefined {
  if (amount == null || !Number.isFinite(amount)) return undefined;
  return Math.round(amount / 10_000);
}

/**
 * Dummy Encar asks meaning “contact us”. Keep this tight: 500/1000만원 are
 * normal used-car prices, and old cars routinely list well below MSRP
 * (e.g. 550만원 on a 5,350만원 originPrice).
 */
const PLACEHOLDER_MANWON = new Set([
  1, 10, 11, 77, 99, 111, 123, 777, 888, 999, 1111, 1234, 2222, 3333,
]);

export type EncarNormalizedPrice = {
  krw?: number;
  manwon?: number;
  onRequest: boolean;
};

export type EncarListingActivity = {
  isActive: boolean;
  listingStatus: "active" | "sold" | "reserved" | "inactive";
};

export type EncarAdvertisementFields = {
  price?: unknown;
  originPrice?: unknown;
  status?: string;
  soldDate?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function extractEncarAdvertisementFields(payload: unknown): EncarAdvertisementFields {
  const root = asRecord(payload);
  if (!root) return {};
  const detail = asRecord(root.detail) ?? root;
  const view = asRecord(root.view);
  const advertisement = {
    ...(asRecord(view?.advertisement) ?? {}),
    ...(asRecord(detail.advertisement) ?? {}),
  };
  const category = {
    ...(asRecord(view?.category) ?? {}),
    ...(asRecord(detail.category) ?? {}),
  };
  const status =
    typeof advertisement.status === "string"
      ? advertisement.status
      : typeof advertisement.salesStatus === "string"
        ? advertisement.salesStatus
        : undefined;
  const soldDateRaw =
    advertisement["soldDate"] ??
    advertisement["sellDate"] ??
    advertisement["closeDate"] ??
    advertisement["expireDate"] ??
    advertisement["soldDateTime"];
  const soldDate = typeof soldDateRaw === "string" && soldDateRaw.trim() ? soldDateRaw.trim() : undefined;
  return {
    price: advertisement.price,
    originPrice: category.originPrice,
    status,
    soldDate,
  };
}

export function normalizeEncarListingActivity(status?: string | null): EncarListingActivity {
  const raw = (status ?? "").trim();
  const upper = raw.toUpperCase();
  if (!raw || upper === "ADVERTISE" || upper === "ACTIVE" || upper === "SALE") {
    return { isActive: true, listingStatus: "active" };
  }
  if (upper === "SOLD" || upper.includes("SOLD") || raw === "판매완료") {
    return { isActive: false, listingStatus: "sold" };
  }
  if (upper === "RESERVED" || upper === "HOLD" || raw === "예약") {
    return { isActive: true, listingStatus: "reserved" };
  }
  if (upper === "STOP" || upper === "HIDDEN" || upper === "DELETE" || upper === "DELETED") {
    return { isActive: false, listingStatus: "inactive" };
  }
  return { isActive: true, listingStatus: "active" };
}

function isPlaceholderManwon(manwon: number): boolean {
  const rounded = Math.round(manwon);
  if (rounded < 20) return true;
  if (PLACEHOLDER_MANWON.has(rounded)) return true;
  const digits = String(rounded);
  return digits.length >= 3 && /^(\d)\1+$/.test(digits);
}

export function normalizeEncarListedPrice(
  raw: unknown,
  _originManwon?: unknown,
): EncarNormalizedPrice {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { onRequest: true };

  const manwon = n >= 100_000 ? n / 10_000 : n;
  const krw = Math.round(manwon * 10_000);

  if (isPlaceholderManwon(manwon)) {
    return { krw, manwon, onRequest: true };
  }

  void _originManwon;
  return { krw, manwon, onRequest: false };
}
