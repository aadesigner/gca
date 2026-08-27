const CURRENT_YEAR = new Date().getFullYear();

export const YEAR_OPTIONS = Array.from(
  { length: CURRENT_YEAR + 1 - 1998 + 1 },
  (_, i) => CURRENT_YEAR + 1 - i,
);

export type FilterStep = { label: string; value?: number };

export const KRW_PRICE_STEPS: FilterStep[] = [
  { label: "Any" },
  { label: "₩10m", value: 10_000_000 },
  { label: "₩15m", value: 15_000_000 },
  { label: "₩20m", value: 20_000_000 },
  { label: "₩25m", value: 25_000_000 },
  { label: "₩30m", value: 30_000_000 },
  { label: "₩40m", value: 40_000_000 },
  { label: "₩50m", value: 50_000_000 },
  { label: "₩60m", value: 60_000_000 },
  { label: "₩80m", value: 80_000_000 },
  { label: "₩100m", value: 100_000_000 },
  { label: "₩150m", value: 150_000_000 },
  { label: "₩200m", value: 200_000_000 },
  { label: "₩300m", value: 300_000_000 },
];

export const USD_PRICE_STEPS: FilterStep[] = [
  { label: "Any" },
  { label: "$3k", value: 3_000 },
  { label: "$5k", value: 5_000 },
  { label: "$8k", value: 8_000 },
  { label: "$10k", value: 10_000 },
  { label: "$15k", value: 15_000 },
  { label: "$20k", value: 20_000 },
  { label: "$30k", value: 30_000 },
  { label: "$40k", value: 40_000 },
  { label: "$50k", value: 50_000 },
  { label: "$80k", value: 80_000 },
];

export const ENGINE_STEPS: FilterStep[] = [
  { label: "Any" },
  { label: "1.0L", value: 1000 },
  { label: "1.2L", value: 1200 },
  { label: "1.4L", value: 1400 },
  { label: "1.5L", value: 1500 },
  { label: "1.6L", value: 1600 },
  { label: "1.8L", value: 1800 },
  { label: "2.0L", value: 2000 },
  { label: "2.2L", value: 2200 },
  { label: "2.5L", value: 2500 },
  { label: "3.0L", value: 3000 },
  { label: "3.5L", value: 3500 },
  { label: "4.0L", value: 4000 },
  { label: "5.0L", value: 5000 },
  { label: "6.0L", value: 6000 },
];

export const MILEAGE_STEPS: FilterStep[] = [
  { label: "Any" },
  { label: "10k km", value: 10_000 },
  { label: "20k km", value: 20_000 },
  { label: "30k km", value: 30_000 },
  { label: "50k km", value: 50_000 },
  { label: "80k km", value: 80_000 },
  { label: "100k km", value: 100_000 },
  { label: "150k km", value: 150_000 },
  { label: "200k km", value: 200_000 },
];

export const IMPORT_MAKES = [
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

export const DOMESTIC_MAKES = [
  "Hyundai",
  "Kia",
  "Genesis",
  "Chevrolet",
  "KG Mobility",
  "Renault",
  "Samsung",
];

export const MODELS_BY_MAKE: Record<string, string[]> = {
  BMW: ["1 Series", "2 Series", "3 Series", "4 Series", "5 Series", "6 Series", "7 Series", "8 Series", "X1", "X2", "X3", "X4", "X5", "X6", "X7", "XM", "Z4", "i3", "i4", "i5", "i7", "iX", "iX1", "iX2", "iX3"],
  "Mercedes-Benz": ["A-Class", "B-Class", "C-Class", "E-Class", "S-Class", "CLA", "CLE", "CLS", "GLA", "GLB", "GLC", "GLE", "GLS", "G-Class", "SL", "AMG GT", "EQA", "EQB", "EQC", "EQE", "EQS", "V-Class"],
  Audi: ["A1", "A3", "A4", "A5", "A6", "A7", "A8", "Q2", "Q3", "Q4", "Q5", "Q7", "Q8", "TT", "R8", "e-tron", "e-tron GT"],
  Volkswagen: ["Golf", "Polo", "Passat", "Jetta", "Arteon", "Tiguan", "Touareg", "T-Roc", "ID.4", "ID.Buzz"],
  Volvo: ["S60", "S90", "V60", "V90", "XC40", "XC60", "XC90", "C40", "EX30", "EX90"],
  Porsche: ["911", "718", "Panamera", "Cayenne", "Macan", "Taycan"],
  "Land Rover": ["Range Rover", "Range Rover Sport", "Range Rover Velar", "Range Rover Evoque", "Defender", "Discovery", "Discovery Sport"],
  Jaguar: ["XE", "XF", "XJ", "F-Pace", "E-Pace", "I-Pace", "F-Type"],
  Mini: ["Cooper", "Clubman", "Countryman", "Convertible"],
  Tesla: ["Model 3", "Model Y", "Model S", "Model X"],
  Lexus: ["ES", "IS", "LS", "NX", "RX", "GX", "LX", "UX", "RC", "LC", "RZ"],
  Toyota: ["Camry", "Corolla", "Prius", "RAV4", "Highlander", "Land Cruiser", "Prado", "Alphard", "Crown"],
  Honda: ["Civic", "Accord", "CR-V", "HR-V", "Pilot", "Odyssey"],
  Ford: ["Mustang", "Explorer", "Escape", "F-150", "Ranger", "Bronco", "Expedition"],
  Jeep: ["Wrangler", "Grand Cherokee", "Cherokee", "Compass", "Renegade", "Gladiator"],
  Lincoln: ["Aviator", "Corsair", "Nautilus", "Navigator"],
  Genesis: ["G70", "G80", "G90", "GV60", "GV70", "GV80"],
  Hyundai: ["Avante", "Sonata", "Grandeur", "Tucson", "Santa Fe", "Palisade", "Kona", "Venue", "Ioniq 5", "Ioniq 6", "Staria", "Casper"],
  Kia: ["K3", "K5", "K8", "K9", "Morning", "Ray", "Seltos", "Sportage", "Sorento", "Carnival", "EV3", "EV6", "EV9", "Niro"],
  Chevrolet: ["Spark", "Malibu", "Trax", "Trailblazer", "Equinox", "Tahoe", "Camaro", "Bolt"],
  "KG Mobility": ["Tivoli", "Korando", "Rexton", "Torres", "Musso"],
  Renault: ["QM6", "SM6", "XM3", "Arkana", "Captur"],
  Maserati: ["Ghibli", "Quattroporte", "Levante", "Grecale", "GranTurismo"],
  Lamborghini: ["Huracan", "Urus", "Aventador"],
  Bentley: ["Continental", "Flying Spur", "Bentayga"],
  Ferrari: ["Roma", "Portofino", "F8", "296", "SF90", "Purosangue"],
  Peugeot: ["208", "308", "508", "2008", "3008", "5008"],
  Polestar: ["Polestar 2", "Polestar 3", "Polestar 4"],
  Cadillac: ["CT4", "CT5", "XT5", "XT6", "Escalade", "Lyriq"],
  Infiniti: ["Q50", "QX50", "QX60", "QX80"],
  Nissan: ["Altima", "Rogue", "Pathfinder", "Leaf", "Ariya", "GT-R"],
  Mazda: ["Mazda3", "CX-5", "CX-50", "CX-60", "CX-90", "MX-5"],
  Subaru: ["Impreza", "Outback", "Forester", "Crosstrek", "BRZ"],
  BYD: ["Atto 3", "Seal", "Sealion 7"],
  GMC: ["Sierra", "Yukon", "Canyon", "Hummer EV"],
};

export function makesForCarType(carType?: string): string[] {
  if (carType === "domestic") return [...DOMESTIC_MAKES];
  if (carType === "all") return [...new Set([...DOMESTIC_MAKES, ...IMPORT_MAKES])];
  return [...IMPORT_MAKES];
}

export function modelsForMake(make?: string): string[] {
  if (!make?.trim()) return [];
  const exact = MODELS_BY_MAKE[make.trim()];
  if (exact) return exact;
  const key = Object.keys(MODELS_BY_MAKE).find((name) => name.toLowerCase() === make.trim().toLowerCase());
  return key ? MODELS_BY_MAKE[key]! : [];
}

export function formatPriceFilter(amount: number, usd = false): string {
  if (usd) {
    if (amount >= 1000) return `$${Math.round(amount / 1000)}k`;
    return `$${amount.toLocaleString()}`;
  }
  if (amount >= 1_000_000) return `₩${Math.round(amount / 1_000_000)}m`;
  return `₩${amount.toLocaleString()}`;
}

export function formatEngineFilter(cc: number): string {
  const liters = cc / 1000;
  return liters % 1 === 0 ? `${liters.toFixed(0)}L` : `${liters.toFixed(1)}L`;
}
