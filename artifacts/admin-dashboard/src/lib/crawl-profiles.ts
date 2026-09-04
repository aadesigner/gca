export type CrawlExtraction =
  | "api-vin"
  | "html-vin-detail"
  | "html-vin-list"
  | "html-vin-rare"
  | "html-vin-masked"
  | "api-token-vin"
  | "api-json";

export interface CrawlProfile {
  extraction: CrawlExtraction;
  summary: string;
  delayMs: number;
  concurrency: number;
  retryCount: number;
  skipRecentHours: number;
  detailLevel: "full" | "standard";
}

export const CRAWL_PROFILES: Record<string, CrawlProfile> = {
  encar: {
    extraction: "api-vin",
    summary: "Encar JSON API. VIN from detail/inspection. Persist VIN-only.",
    delayMs: 500,
    concurrency: 3,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  ams: {
    extraction: "api-vin",
    summary: "Encar JSON API (AMS alias). Persist VIN-only.",
    delayMs: 500,
    concurrency: 3,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  autowini: {
    extraction: "api-vin",
    summary: "Autowini v2 API. VIN on detail. Persist VIN-only.",
    delayMs: 400,
    concurrency: 3,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  kbchachacha: {
    extraction: "html-vin-detail",
    summary: "KB HTML search + inspection sheet VIN. Persist VIN-only.",
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  mango: {
    extraction: "html-vin-rare",
    summary: "Mango HTML/Nuxt. Public VIN is rare; only VIN rows are stored.",
    delayMs: 1000,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  seobuk: {
    extraction: "html-vin-detail",
    summary: "Seobuk HTML. VIN on the detail spec table.",
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  koreaauto_auction: {
    extraction: "wp-rest-vin-detail",
    summary:
      "KAA Auction (koreaauto.auction). WP vehicle CPT REST list (~294); VIN/price/km/photos from detail + media API.",
    delayMs: 600,
    concurrency: 3,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  ssancar: {
    extraction: "html-vin-masked",
    summary: "SSANCAR HTML. Public VIN is usually masked; only complete VINs persist.",
    delayMs: 1000,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  carpoolkr: {
    extraction: "html-vin-list",
    summary: "Carpool HTML. VIN on list and detail pages.",
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  lotte_autoglobal: {
    extraction: "api-list-ajax",
    summary:
      "Lotte Auto Global list AJAX (VIN clsNo, km drgMil, USD, raw photos). Detail gated; refresh via search_clsNo.",
    delayMs: 500,
    concurrency: 3,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  kolon_auto: {
    extraction: "api-list-ajax",
    summary:
      "Kolon Auto International buy-now API. List km+USD; detail VIN + gallery. ~65k stock.",
    delayMs: 400,
    concurrency: 4,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  auctionauto: {
    extraction: "api-json",
    summary:
      "auctionauto.org: Korea/China catalog cars + USA Copart/IAA lots. Mileage, photos, live bid/price; sold uses saleDate not crawl time.",
    delayMs: 400,
    concurrency: 6,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  koreausedcars: {
    extraction: "html-vin-detail",
    summary: "Korea Used Cars HTML. VIN on detail; sold-out cards are marked inactive.",
    delayMs: 1000,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  auctionwini: {
    extraction: "api-token-vin",
    summary: "Auctionwini API when AUCTIONWINI_TOKEN is set; otherwise homepage HTML.",
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  autoscout24: {
    extraction: "html-vin-rare",
    summary: "AutoScout24 EU. VIN only when labeled in description/JSON.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  autotraderca: {
    extraction: "html-vin-detail",
    summary: "AutoTrader.ca. Dealer ads often include VIN.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  dubicars: {
    extraction: "html-vin-detail",
    summary: "Dubicars UAE. Chassis/VIN from labeled detail.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  otomoto: {
    extraction: "html-vin-rare",
    summary: "Otomoto.pl. VIN from description when labeled.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  kcar: {
    extraction: "html-vin-detail",
    summary: "KCar Korea. VIN/차대번호 when public.",
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  cars24ae: {
    extraction: "html-vin-detail",
    summary: "Cars24.ae. VIN from labeled detail when present.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  willhaben: {
    extraction: "html-vin-list",
    summary: "Willhaben.at. Skip ads with no VIN mention on the list.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  carpages: {
    extraction: "html-vin-detail",
    summary: "Carpages.ca. VIN from labeled specs/description.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  autobell: {
    extraction: "html-vin-detail",
    summary: "Autobell KR auction. VIN/차대번호 from detail.",
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  import_motor: {
    extraction: "html-vin-detail",
    summary:
      "Import Motor CDP. origins korean = fast skip clear US list cards (opened pages still saved). fullCrawlCountries e.g. al = everything.",
    delayMs: 70,
    concurrency: 16,
    retryCount: 5,
    skipRecentHours: 0,
    detailLevel: "full",
  },
};

export function crawlProfileFor(internalName?: string | null): CrawlProfile | null {
  if (!internalName) return null;
  return CRAWL_PROFILES[internalName] ?? null;
}

export function extractionLabel(extraction: CrawlExtraction): string {
  switch (extraction) {
    case "api-vin":
      return "API · VIN-only";
    case "html-vin-detail":
      return "HTML detail · VIN-only";
    case "html-vin-list":
      return "HTML list+detail · VIN-only";
    case "html-vin-rare":
      return "HTML · VIN rare";
    case "html-vin-masked":
      return "HTML · VIN often masked";
    case "api-token-vin":
      return "API token · VIN-only";
    case "api-json":
      return "API JSON";
    default:
      return "VIN-only";
  }
}
