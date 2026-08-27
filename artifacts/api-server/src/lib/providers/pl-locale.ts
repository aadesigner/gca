/**
 * Polish marketplace labels → English (Otomoto and similar PL sources).
 */

const TRANSMISSION: Record<string, string> = {
  automatyczna: "Automatic",
  automatyczna_skrzynia: "Automatic",
  "skrzynia automatyczna": "Automatic",
  automatic: "Automatic",
  auto: "Automatic",
  manualna: "Manual",
  "skrzynia manualna": "Manual",
  manual: "Manual",
  polautomatyczna: "Semi-automatic",
  "pólautomatyczna": "Semi-automatic",
  "półautomatyczna": "Semi-automatic",
  cvt: "CVT",
  dsg: "DCT",
  dct: "DCT",
};

const FUEL: Record<string, string> = {
  benzyna: "Gasoline",
  petrol: "Gasoline",
  gasoline: "Gasoline",
  diesel: "Diesel",
  olej_napędowy: "Diesel",
  "olej napędowy": "Diesel",
  "olej napedowy": "Diesel",
  lpg: "LPG",
  gaz: "LPG",
  cng: "CNG",
  hybryda: "Hybrid",
  hybrid: "Hybrid",
  "benzyna+lpg": "Gasoline+LPG",
  "benzyna + lpg": "Gasoline+LPG",
  elektryczny: "Electric",
  electric: "Electric",
  ev: "Electric",
  wodór: "Hydrogen",
  hydrogen: "Hydrogen",
};

const COLOR: Record<string, string> = {
  czarny: "Black",
  black: "Black",
  biały: "White",
  bialy: "White",
  white: "White",
  srebrny: "Silver",
  silver: "Silver",
  szary: "Gray",
  grey: "Gray",
  gray: "Gray",
  czerwony: "Red",
  red: "Red",
  niebieski: "Blue",
  blue: "Blue",
  zielony: "Green",
  green: "Green",
  żółty: "Yellow",
  zolty: "Yellow",
  yellow: "Yellow",
  pomarańczowy: "Orange",
  pomaranczowy: "Orange",
  orange: "Orange",
  brązowy: "Brown",
  brazowy: "Brown",
  brown: "Brown",
  beżowy: "Beige",
  bezowy: "Beige",
  beige: "Beige",
  złoty: "Gold",
  zloty: "Gold",
  gold: "Gold",
  fioletowy: "Purple",
  purple: "Purple",
  różowy: "Pink",
  rozowy: "Pink",
  pink: "Pink",
  bordowy: "Burgundy",
  burgundy: "Burgundy",
  granatowy: "Navy",
  navy: "Navy",
  turkusowy: "Turquoise",
  turquoise: "Turquoise",
  inny: "Other",
  other: "Other",
};

const BODY: Record<string, string> = {
  sedan: "Sedan",
  kombi: "Wagon",
  wagon: "Wagon",
  hatchback: "Hatchback",
  "minivan/mikrovan": "Minivan",
  minivan: "Minivan",
  mikrovan: "Minivan",
  suv: "SUV",
  "suv / terenowy": "SUV",
  terenowy: "SUV",
  coupe: "Coupe",
  coupé: "Coupe",
  cabrio: "Convertible",
  kabriolet: "Convertible",
  convertible: "Convertible",
  pickup: "Pickup",
  van: "Van",
  city_car: "City car",
  "city car": "City car",
};

function lookup(map: Record<string, string>, raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  const key = trimmed.toLowerCase();
  return map[key] ?? map[key.replace(/_/g, " ")] ?? trimmed;
}

export function normalizePlTransmission(raw?: string | null): string | undefined {
  return lookup(TRANSMISSION, raw);
}

export function normalizePlFuel(raw?: string | null): string | undefined {
  return lookup(FUEL, raw);
}

export function normalizePlColor(raw?: string | null): string | undefined {
  return lookup(COLOR, raw);
}

export function normalizePlBody(raw?: string | null): string | undefined {
  return lookup(BODY, raw);
}
