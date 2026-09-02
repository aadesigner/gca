/**
 * Curated sandbox VINs — free on any API key (no credits). Real VINs cost 1 credit each.
 */
export interface TestVin {
  vin: string;
  region: "usa" | "canada" | "korea" | "uae";
  label: string;
  make: string;
  model: string;
  year: number;
  market: string;
  description: string;
}

export const TEST_VINS: readonly TestVin[] = [
  {
    vin: "1FA6P8CF5K5120103",
    region: "usa",
    label: "Ford Mustang GT 2019",
    make: "Ford",
    model: "Mustang GT",
    year: 2019,
    market: "iaa",
    description: "US salvage auction — 55+ imgsv CDN photos, auction timeline & events",
  },
  {
    vin: "ZAM57XSA5H1238315",
    region: "uae",
    label: "Maserati Ghibli S 2017",
    make: "Maserati",
    model: "Ghibli S",
    year: 2017,
    market: "dubicars",
    description: "Dubai retail listing — full imgsv gallery, price & mileage observations",
  },
  {
    vin: "WDDUX8GB8JA397509",
    region: "korea",
    label: "Mercedes-Benz S-Class 2018",
    make: "Mercedes-Benz",
    model: "S-Class",
    year: 2018,
    market: "encar",
    description: "Korean Encar — 45+ registry events, 55+ imgsv photos, insurance history",
  },
  {
    vin: "ZAM57XSA4E1123233",
    region: "korea",
    label: "Maserati Ghibli 2014",
    make: "Maserati",
    model: "Ghibli",
    year: 2014,
    market: "encar",
    description: "Korean Encar — 45+ events, accident & owner timeline, full photo gallery",
  },
  {
    vin: "WBS3C910XFP708160",
    region: "korea",
    label: "BMW M3 2015",
    make: "BMW",
    model: "M3",
    year: 2015,
    market: "autowini",
    description: "Korean export (Autowini + Encar) — 20+ events, mileage & price history, imgsv photos",
  },
] as const;

const TEST_VIN_SET = new Set(TEST_VINS.map((t) => t.vin));

export function normalizeTestVin(raw: string): string {
  return raw.toUpperCase().trim();
}

export function isTestVin(raw: string): boolean {
  return TEST_VIN_SET.has(normalizeTestVin(raw));
}

export function getTestVin(raw: string): TestVin | undefined {
  const vin = normalizeTestVin(raw);
  return TEST_VINS.find((t) => t.vin === vin);
}

/** Public metadata for portal + API discovery (no secrets or crawl internals). */
export function getTestVinsPublic() {
  return TEST_VINS.map((t) => ({
    vin: t.vin,
    region: t.region,
    label: t.label,
    make: t.make,
    model: t.model,
    year: t.year,
    retrievePath: `/api/v1/vin/${t.vin}`,
    checkPath: `/api/v1/vin/check/${t.vin}`,
    creditRequired: false,
  }));
}
