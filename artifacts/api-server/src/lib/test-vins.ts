/**
 * Curated VINs for integration testing. Retrieve always succeeds with a valid
 * Bearer token — no credit balance required and per-VIN rate limits are waived.
 */
export interface TestVin {
  vin: string;
  region: "usa" | "canada" | "korea";
  label: string;
  make: string;
  model: string;
  year: number;
  market: string;
  description: string;
}

export const TEST_VINS: readonly TestVin[] = [
  {
    vin: "1C4PJLAB8HW652533",
    region: "usa",
    label: "Jeep Cherokee 2017",
    make: "Jeep",
    model: "Cherokee",
    year: 2017,
    market: "copart",
    description: "US salvage auction — 100+ photos, auction timeline",
  },
  {
    vin: "3GTUUBED2TG205512",
    region: "canada",
    label: "GMC Sierra 1500 2026",
    make: "GMC",
    model: "Sierra 1500",
    year: 2026,
    market: "autotraderca",
    description: "Canadian retail listing — photos, price & mileage observations",
  },
  {
    vin: "WDDWF0EB8GR178219",
    region: "korea",
    label: "Mercedes-Benz C-Class 2016",
    make: "Mercedes-Benz",
    model: "C-Class",
    year: 2016,
    market: "encar",
    description: "Korean Encar — insurance & owner history, 80+ events, gallery",
  },
  {
    vin: "WP1AF2928GLA45746",
    region: "korea",
    label: "Porsche Cayenne 2016",
    make: "Porsche",
    model: "Cayenne",
    year: 2016,
    market: "encar",
    description: "Korean Encar — accident timeline, 70 events, photos",
  },
  {
    vin: "KMHE341DBJA456079",
    region: "korea",
    label: "Hyundai Sonata 2018",
    make: "Hyundai",
    model: "Sonata New Rise",
    year: 2018,
    market: "autowini",
    description: "Korean export listing — events, photos, mileage history",
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

/** Public metadata for portal + API discovery (no secrets). */
export function getTestVinsPublic() {
  return TEST_VINS.map((t) => ({
    vin: t.vin,
    region: t.region,
    label: t.label,
    make: t.make,
    model: t.model,
    year: t.year,
    market: t.market,
    description: t.description,
    retrievePath: `/api/v1/vin/${t.vin}`,
    checkPath: `/api/v1/vin/check/${t.vin}`,
    creditRequired: false,
  }));
}
