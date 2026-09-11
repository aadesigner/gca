/**
 * Per-provider historical crawl defaults.
 * History persist is always VIN-only; these settings control how we fetch.
 */
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
    summary: "Mango HTML/Nuxt cards. Public VIN is rare; only VIN rows are stored.",
    delayMs: 1000,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  seobuk: {
    extraction: "html-vin-detail",
    summary: "Seobuk/Carmanager HTML. VIN on the detail spec table.",
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  koreaauto_auction: {
    extraction: "wp-rest-vin-detail",
    summary:
      "KAA Auction (koreaauto.auction). WP vehicle CPT REST list (~294); VIN/price/km/photos from detail HTML + media API.",
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
      "Lotte Auto Global list AJAX (clsNo VIN, drgMil km, USD price, raw img CDN). Detail HTML is gated; refresh uses search_clsNo.",
    delayMs: 500,
    concurrency: 3,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  kolon_auto: {
    extraction: "api-list-ajax",
    summary:
      "Kolon Auto International (Sellcar) buy-now API. List has km+USD; detail getCarInfo has VIN + gallery. ~65k stock.",
    delayMs: 400,
    concurrency: 4,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  auctionauto: {
    extraction: "api-json",
    summary:
      "auctionauto.org: Korea/USA sharded by make→model (API 10k window). VIN-only persist; sold uses saleDate.",
    delayMs: 400,
    concurrency: 6,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  koreausedcars: {
    extraction: "html-vin-detail",
    summary: "Korea Used Cars (PICKPLUS) HTML. VIN on detail; sold-out overlay on cards.",
    delayMs: 1000,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  auctionwini: {
    extraction: "api-list-odometer",
    summary: "Auctionwini live-auction list API (odometer on each item). Detail API needs AUCTIONWINI_TOKEN.",
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  heydealer: {
    extraction: "api-json",
    summary: "Heydealer market API (JWT auth). Rich specs; no public VIN.",
    delayMs: 600,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  bobaedream: {
    extraction: "html-vin-rare",
    summary: "Bobaedream MyCar direct listings. No public VIN.",
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  bobaedreamcyber: {
    extraction: "html-vin-rare",
    summary: "Bobaedream CyberCar dealer channel. No public VIN.",
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  salvagebid: {
    extraction: "html-vin-detail",
    summary: "Salvagebid broker (Copart/IAA lots). Lot JSON: VIN, odometer, photos, damage. Not similar-lot data.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  bidexport: {
    extraction: "api-json",
    summary: "BidExport.com US auction broker. POST /filter for Automobile+Truck — VIN, mileage (mi), IAA gallery, damage/title.",
    delayMs: 1000,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  bringatrailer: {
    extraction: "html-vin-detail",
    summary: "Bring a Trailer collector car auctions. VIN in listing text; sold price from stats.",
    delayMs: 1500,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 24,
    detailLevel: "full",
  },
  iaa: {
    extraction: "html-vin-masked",
    summary: "IAA (Insurance Auto Auctions). Full specs from detail page; VIN partially masked for anonymous. ~100 newest lots per discovery.",
    delayMs: 1500,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  autoscout24: {
    extraction: "html-vin-rare",
    summary: "AutoScout24 EU Next.js. VIN only from labeled description/JSON (often hidden). Skip persist without VIN.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  autotraderca: {
    extraction: "html-vin-detail",
    summary: "AutoTrader.ca Next.js. Dealer ads often include VIN in specs/description.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  dubicars: {
    extraction: "html-vin-detail",
    summary: "Dubicars UAE dealer inventory. Chassis/VIN from labeled detail text.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  otomoto: {
    extraction: "html-vin-rare",
    summary: "Otomoto.pl (OLX). VIN from description/params when labeled.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  kcar: {
    extraction: "html-vin-detail",
    summary: "KCar Korea Nuxt/API. Inspection-style specs; VIN/차대번호 when public.",
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  cars24ae: {
    extraction: "html-vin-detail",
    summary: "Cars24.ae inspected stock. VIN from labeled detail when present.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  aaaauto: {
    extraction: "html-vin-detail",
    summary: "AAA Auto SK (aaaauto.sk). EU dealer stock — VIN, mileage, gallery, STK/history; country from countryRegion when present.",
    delayMs: 900,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  autoplac: {
    extraction: "api-json",
    summary:
      "Autoplac.pl. Search API is SSR-gated (empty to clients); list via CDP ng-state (?p=&seoCategories=); detail/list APIs work from Node.",
    delayMs: 1100,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  autoscout24_es: {
    extraction: "html-vin-rare",
    summary: "AutoScout24 Spain. Next.js offers; VIN when labeled in description/JSON.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  autoscout24_be: {
    extraction: "html-vin-rare",
    summary: "AutoScout24 Belgium (FR). Next.js offers; VIN when labeled in description/JSON.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  autotradernl: {
    extraction: "html-vin-rare",
    summary: "AutoTrader.nl (AS24 family). Next.js offers; VIN when labeled.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  sauto: {
    extraction: "api-json",
    summary: "Sauto.cz JSON API. VIN/mileage/photos from item detail; CZK stock.",
    delayMs: 1000,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  automobileit: {
    extraction: "html-vin-detail",
    summary: "Automobile.it Next.js. Specs from vehicleInformation; VIN from description when labeled.",
    delayMs: 1100,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  subito: {
    extraction: "html-vin-detail",
    summary: "Subito.it classifieds. List features + detail HTML VIN scan.",
    delayMs: 1100,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  standvirtual: {
    extraction: "html-vin-detail",
    summary: "Standvirtual.pt (OLX Cars PT). VIN from params/description when labeled.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  mobilebg: {
    extraction: "html-vin-detail",
    summary: "Mobile.bg HTML listings. VIN/Шаси labels, BGN/EUR price, gallery photos.",
    delayMs: 1100,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  willhaben: {
    extraction: "html-vin-list",
    summary: "Willhaben.at. Skip detail when list description has no VIN mention.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  ontariocars: {
    extraction: "html-vin-detail",
    summary:
      "OntarioCars.ca (UCDA/Carpages dealer site). Make+truck category shards avoid ES 10k window; VIN/km/CAD; photos scoped to inventory id (no related thumbs).",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  carpages: {
    extraction: "html-vin-detail",
    summary: "Carpages.ca. VIN from labeled dealer description/specs; photos scoped to inventory id only.",
    delayMs: 1200,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  thebidrive: {
    extraction: "html-vin-detail",
    summary:
      "TheBidrive.com auctions (/lot) + marketplaces (/listing). LD+JSON VIN/mileage/USD price/CDN photos; sold→sale event; EN locale.",
    delayMs: 900,
    concurrency: 3,
    retryCount: 3,
    skipRecentHours: 0,
    detailLevel: "full",
  },
  japanesecartrade: {
    extraction: "html-vin-detail",
    summary:
      "JapaneseCarTrade.com (~250k JP export stock). Make-sharded HTML list; ISO VIN or JP chassis; km + FOB USD; gallery via ___ShowOtherImages. Cloudflare may need JCT_CDP_URL.",
    delayMs: 1100,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 0,
    detailLevel: "full",
  },
  che168: {
    extraction: "api-json",
    summary:
      "Che168 / Autohome Global export (global.che168.com). EN API: USD price, km, gallery; VIN masked on public API; CNY FX tracked.",
    delayMs: 400,
    concurrency: 4,
    retryCount: 3,
    skipRecentHours: 0,
    detailLevel: "full",
  },
  autohome: {
    extraction: "api-json",
    summary:
      "Autohome Global export — same catalog as che168 (fleet-skipped to avoid duplicates).",
    delayMs: 400,
    concurrency: 4,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  autobell: {
    extraction: "html-vin-detail",
    summary: "Autobell KR auction. VIN/차대번호 from detail/API when public.",
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  import_motor: {
    extraction: "html-vin-detail",
    summary:
      "Import Motor CDP buyer-locations country crawl (priority destinations first). Full pages; skip only VIN+mileage+photo-complete; compact JSON.",
    delayMs: 85,
    concurrency: 10,
    retryCount: 5,
    skipRecentHours: 0,
    detailLevel: "full",
  },
  mobilede: {
    extraction: "api-json",
    summary:
      "Mobile.de BFF JSON API. VIN from dealer description (Fahrgestell-Nr). Gallery from galleryImages. ~50p/search; year sharding for full catalog.",
    delayMs: 600,
    concurrency: 3,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  copart: {
    extraction: "html-vin-detail",
    summary:
      "US salvage catalog (IAAI then Copart). IAAI lots persist to iaa (photos from vis.iaai.com); Copart lots to copart.",
    delayMs: 140,
    concurrency: 10,
    retryCount: 3,
    skipRecentHours: 8,
    detailLevel: "full",
  },
  charancha: {
    extraction: "html-vin-detail",
    summary: "Charancha KR marketplace. VIN from detail when public.",
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  autohub: {
    extraction: "html-vin-detail",
    summary: "Autohub KR dealer stock. VIN from detail when public.",
    delayMs: 900,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  lotteautoauction: {
    extraction: "html-vin-detail",
    summary: "Lotte Auto Auction KR. Exhibit list + detail VIN when public.",
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  autoinside: {
    extraction: "html-vin-detail",
    summary: "AutoInside KR used cars. VIN from detail when public.",
    delayMs: 900,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  autobellglobal: {
    extraction: "html-vin-detail",
    summary: "Autobell Global export auction. VIN from detail when public.",
    delayMs: 800,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  rbautotrade: {
    extraction: "html-vin-detail",
    summary: "RB Autotrade KR stock. VIN from detail when public.",
    delayMs: 900,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
  senaauto: {
    extraction: "html-vin-detail",
    summary: "Sena Auto KR stock. VIN from detail when public.",
    delayMs: 900,
    concurrency: 2,
    retryCount: 3,
    skipRecentHours: 12,
    detailLevel: "full",
  },
};

export const HISTORICAL_ADAPTER_NAMES = new Set(Object.keys(CRAWL_PROFILES));

export function crawlProfileFor(internalName: string): CrawlProfile {
  return (
    CRAWL_PROFILES[internalName] ?? {
      extraction: "html-vin-detail",
      summary: "HTML detail fetch. Persist VIN-only.",
      delayMs: 800,
      concurrency: 2,
      retryCount: 3,
      skipRecentHours: 12,
      detailLevel: "full",
    }
  );
}

/** Fill crawl knobs the client omitted; explicit job filters always win. */
export function mergeCrawlDefaults(
  internalName: string,
  filters: Record<string, unknown> | undefined,
  jobType: string,
): Record<string, unknown> {
  const profile = crawlProfileFor(internalName);
  const next: Record<string, unknown> = { ...(filters ?? {}) };
  const setIfMissing = (key: string, value: unknown) => {
    if (next[key] == null || next[key] === "") next[key] = value;
  };
  setIfMissing("delayMs", profile.delayMs);
  setIfMissing("concurrency", profile.concurrency);
  setIfMissing("retryCount", profile.retryCount);
  setIfMissing("skipRecentHours", profile.skipRecentHours);
  if (jobType === "listing_refresh") setIfMissing("detailLevel", "standard");
  else setIfMissing("detailLevel", profile.detailLevel);
  return next;
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
