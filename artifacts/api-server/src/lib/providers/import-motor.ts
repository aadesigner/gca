/**
 * Import Motor (import-motor.com) historical adapter — CRAWL PARKED.
 * Code is kept as the working method; do not delete. Provider should stay disabled
 * unless someone explicitly re-enables a collection job.
 *
 * How the crawl works (brand mode — preferred):
 * 1. Chrome CDP (IMPORT_MOTOR_CDP_URL); Node TLS is CF-blocked.
 * 2. Discover: /{brand}?page=N ("Showing X to Y of Z") — e.g. /audi, /mercedes-benz.
 * 3. Brand shards from IMPORT_MOTOR_BRAND_PRIORITY (or job filters.brands).
 * 4. Each list row → /v/{VIN} detail parse. Persist VIN+mileage+make/model as compact JSON.
 * 5. US/CA lots → copart/iaa with source_id im-{lot}.
 * 6. Photos: source URLs + R2 mirror.
 *
 * Legacy country mode still works via crawlMode=countries / buyer-locations/{cc}.
 */
import type { FetchedListing, ListingReference, NormalizedListing, PaginationInfo } from "@workspace/providers";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch, KrRequestError } from "./kr-http";
import { importMotorGetViaCdp, importMotorUsesCdp } from "./import-motor-cdp";
import {
  attachImportMotorSpinPhotos,
  extractImportMotorVinUrl,
  guessImportMotorOriginFromSnippet,
  IMPORT_MOTOR_PARSER_VERSION,
  IMPORT_MOTOR_WEB_BASE,
  normalizeImportMotorOrigins,
  originAllowed,
  parseImportMotorDetail,
  type ImportMotorOrigin,
} from "./import-motor-parse";
import type { KrFilterParams } from "./kr-common";

export { IMPORT_MOTOR_PARSER_VERSION, IMPORT_MOTOR_WEB_BASE };

export type ImportMotorFilterParams = KrFilterParams & {
  /** Limit crawl to these buyer-location country codes (e.g. ["al","us"]). */
  countries?: string[];
  /**
   * Brand path slugs on import-motor.com (e.g. ["audi","bmw","mercedes-benz"]).
   * When set (or crawlMode=brands), country shards are not used.
   */
  brands?: string[];
  /** Explicit crawl mode. Defaults to brands when `brands` is non-empty. */
  crawlMode?: "brands" | "countries";
  /**
   * Prefer these origins when scanning list pages (skip clearly-other cards to go fast).
   * Use ["encar","autowini"] or ["korean"]. Once a detail page is opened, it is always
   * persisted (US/CA included) unless already crawled from Import Motor.
   */
  origins?: Array<ImportMotorOrigin | "korean" | "korea" | "kr">;
  /**
   * Buyer-location codes that ignore `origins` and fetch every list card
   * (e.g. ["al"] for a full Albania dump).
   */
  fullCrawlCountries?: string[];
  /** When true, fetch every list-card origin (ignore `origins` prefer filter). */
  fullCrawl?: boolean;
};

/**
 * Popular make pages on import-motor.com — `/audi`, `/bmw`, `/mercedes-benz`, …
 * Order: volume / user priority first.
 */
export const IMPORT_MOTOR_BRAND_PRIORITY: string[] = [
  "audi",
  "mercedes-benz",
  "bmw",
  "volkswagen",
  "porsche",
  "hyundai",
  "toyota",
  "ford",
  "honda",
  "nissan",
  "kia",
  "lexus",
  "land-rover",
  "chevrolet",
  "jeep",
  "mazda",
  "subaru",
  "volvo",
  "tesla",
  "infiniti",
  "acura",
  "gmc",
  "dodge",
  "ram",
  "mitsubishi",
  "genesis",
  "mini",
  "jaguar",
  "bentley",
  "peugeot",
  "renault",
  "skoda",
  "opel",
  "suzuki",
  "fiat",
  "citroen",
  "seat",
  "cadillac",
  "chrysler",
  "buick",
  "lincoln",
  "alfa-romeo",
  "maserati",
];

export function normalizeBrandSlugs(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const slugs = raw
    .map((v) =>
      String(v)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, ""),
    )
    .filter((s) => s.length >= 2 && s.length <= 40);
  return slugs.length > 0 ? [...new Set(slugs)] : undefined;
}

function importMotorHeaders(): Record<string, string> {
  const cookie = process.env.IMPORT_MOTOR_COOKIE?.trim();
  return cookie ? { Cookie: cookie } : {};
}

function looksBlocked(html: string): boolean {
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "";
  return /just a moment|attention required/i.test(title);
}

async function importMotorGet(url: string): Promise<{ url: string; status: number; text: string }> {
  if (importMotorUsesCdp()) {
    return importMotorGetViaCdp(url);
  }
  const fetched = await krFetch(url, {
    referer: IMPORT_MOTOR_WEB_BASE,
    headers: importMotorHeaders(),
  });
  if (looksBlocked(fetched.text)) {
    throw new KrRequestError(
      403,
      "import-motor.com Cloudflare blocked Node fetch. Start Chrome with --remote-debugging-port=9222 and set IMPORT_MOTOR_CDP_URL=http://127.0.0.1:9222 (clearance cookies alone are not enough — TLS fingerprint must match).",
      url,
    );
  }
  return fetched;
}

function extractCountryCodes(html: string): string[] {
  const codes = [
    ...html.matchAll(/\/buyer-locations\/([a-z]{2})(?:["/?#]|$)/gi),
  ].map((m) => m[1]!.toLowerCase());
  return [...new Set(codes)].filter((cc) => /^[a-z]{2}$/.test(cc));
}

/**
 * Crawl order (user priority — small → larger import destinations):
 * 1) Balkans
 * 2) Caucasus + rest of Europe
 * 3) Middle East
 * 4) Russia
 * 5) everyone else (US, Asia, Africa, …) via the `*rest` shard
 */
export const IMPORT_MOTOR_COUNTRY_PRIORITY: string[] = [
  // Balkans (small → larger)
  "me", // Montenegro
  "mk", // North Macedonia
  "xk", // Kosovo
  "ba", // Bosnia and Herzegovina
  "al", // Albania
  "si", // Slovenia
  "hr", // Croatia
  "bg", // Bulgaria
  "rs", // Serbia
  "ro", // Romania
  "gr", // Greece
  // Caucasus / nearby small EU destinations
  "ge", // Georgia
  "am", // Armenia
  "az", // Azerbaijan
  "md", // Moldova
  "ee", // Estonia
  "lv", // Latvia
  "lt", // Lithuania
  "sk", // Slovakia
  "hu", // Hungary
  "cz", // Czechia
  "fi", // Finland
  "ie", // Ireland
  "pt", // Portugal
  "at", // Austria
  "be", // Belgium
  "nl", // Netherlands
  "se", // Sweden
  "no", // Norway
  "dk", // Denmark
  "ch", // Switzerland
  "pl", // Poland
  "es", // Spain
  "it", // Italy
  "fr", // France
  "de", // Germany
  "gb", // United Kingdom
  "ua", // Ukraine (large)
  // Middle East (small → larger)
  "cy", // Cyprus
  "jo", // Jordan
  "lb", // Lebanon
  "bh", // Bahrain
  "qa", // Qatar
  "kw", // Kuwait
  "om", // Oman
  "ae", // UAE
  "il", // Israel
  "iq", // Iraq
  "sa", // Saudi Arabia
  "tr", // Turkey
  // Russia last among named regions
  "ru",
];

const REST_TOKEN = "*rest";

function prioritizeCountries(codes: string[]): string[] {
  const set = new Set(codes);
  const head = IMPORT_MOTOR_COUNTRY_PRIORITY.filter((cc) => set.has(cc));
  const headSet = new Set(head);
  const rest = codes.filter((cc) => !headSet.has(cc));
  return [...head, ...rest];
}

function extractMaxListPage(html: string, pathKey: string): number | undefined {
  let max = 0;
  const escaped = pathKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`buyer-locations\\/${escaped}\\?page=(\\d+)`, "gi"),
    new RegExp(`(?:href=["']|/)${escaped}\\?page=(\\d+)`, "gi"),
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max > 0 ? max : undefined;
}

/** e.g. "Showing 1 to 30 of 4,696 results" — authoritative total for full coverage. */
function extractResultWindow(html: string): { total: number; from: number; to: number } | undefined {
  const m = html.match(/Showing\s+(\d+)\s+to\s+(\d+)\s+of\s+([\d,.\s]+)\s+results/i);
  if (!m) return undefined;
  const from = Number(m[1]);
  const to = Number(m[2]);
  const total = Number(String(m[3]).replace(/[^\d]/g, ""));
  if (![from, to, total].every((n) => Number.isFinite(n)) || total <= 0 || to < from) return undefined;
  return { total, from, to };
}

function inferListPageSize(window: { total: number; from: number; to: number }, listingCount: number): number {
  const span = window.to - window.from + 1;
  if (window.from === 1) return Math.max(span, 1);
  // Last page is often short (e.g. 16 of 30) — infer size from the offset instead.
  for (const candidate of [30, 24, 20, 25, 50, 100, span]) {
    if (candidate > 0 && (window.from - 1) % candidate === 0) return candidate;
  }
  return Math.max(listingCount, span, 30);
}

/**
 * Country list pagination must cover every VIN — never stop at the first page
 * or at the visible pager window alone. Prefer "Showing X to Y of Z results".
 *
 * `sticky` remembers the last known catalog size so a single empty/CF HTML page
 * cannot mark the country complete early.
 */
function listPagination(
  html: string,
  pathKey: string,
  listPage: number,
  listingCount: number,
  sticky?: { total: number; pageSize: number; totalPages: number } | null,
  kind: "country" | "brand" = "country",
): PaginationInfo {
  const window = extractResultWindow(html);
  const pageMax = extractMaxListPage(html, pathKey);
  const pageSize = window
    ? inferListPageSize(window, listingCount)
    : sticky?.pageSize ?? Math.max(listingCount, 30);
  const totalPagesFromCount = window != null ? Math.max(1, Math.ceil(window.total / pageSize)) : undefined;
  // Brand make pages rarely show "Showing X of Z" and the pager only exposes nearby
  // page numbers (e.g. 2–3). Never treat that as the catalog end.
  const totalPages =
    totalPagesFromCount ??
    (kind === "brand"
      ? sticky?.totalPages
      : pageMax && sticky?.totalPages
        ? Math.min(pageMax, sticky.totalPages)
        : pageMax ?? sticky?.totalPages) ??
    undefined;

  const escaped = pathKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nextPage = listPage + 1;
  const hasNextLink =
    (kind === "country"
      ? new RegExp(`buyer-locations\\/${escaped}\\?page=${nextPage}(?:["'\\s>]|$)`, "i").test(html)
      : new RegExp(`(?:/)${escaped}\\?page=${nextPage}(?:["'\\s?#>]|$)`, "i").test(html)) ||
    /rel=["']next["']/i.test(html) ||
    new RegExp(`href=["'][^"']*${escaped}\\?page=${nextPage}["']`, "i").test(html);

  const resultTotal = window?.total ?? sticky?.total;

  let hasMore: boolean;
  if (window != null) {
    hasMore = window.to < window.total;
  } else if (kind === "brand") {
    // Walk forward while the next page link exists or the page is full.
    hasMore = hasNextLink || listingCount >= Math.min(pageSize, 12);
  } else if (listingCount === 0 && !hasNextLink) {
    hasMore = false;
  } else if (sticky != null && listPage < sticky.totalPages && listingCount > 0) {
    hasMore = true;
  } else if (totalPages != null) {
    hasMore = listPage < totalPages || hasNextLink;
  } else {
    hasMore = hasNextLink || listingCount >= pageSize;
  }

  if (window != null && window.from === 1 && window.to >= window.total) {
    hasMore = false;
  }

  if (!hasMore && listingCount >= pageSize && (window == null || window.to < (window.total ?? Infinity))) {
    hasMore = true;
  }

  return {
    currentPage: listPage,
    totalPages: totalPages ?? (hasMore ? listPage + 1 : listPage),
    hasMore: Boolean(hasMore),
    resultTotal,
  };
}

function countryListPagination(
  html: string,
  cc: string,
  listPage: number,
  listingCount: number,
  sticky?: { total: number; pageSize: number; totalPages: number } | null,
): PaginationInfo {
  return listPagination(html, cc, listPage, listingCount, sticky, "country");
}

function brandListPagination(
  html: string,
  brand: string,
  listPage: number,
  listingCount: number,
  sticky?: { total: number; pageSize: number; totalPages: number } | null,
): PaginationInfo {
  return listPagination(html, brand, listPage, listingCount, sticky, "brand");
}

/** Process-local memory of IM country catalog size (adapters are recreated each page). */
const imCountryCoverage = new Map<string, { total: number; pageSize: number; totalPages: number }>();

/**
 * Mapping only: keep the global cursor on an unseen *rest country until
 * "Showing X of Z" sticks. Do NOT use this for expectedTotalPages display.
 */
const REST_STAY_PAGES = 50_000;

/** Honest progress estimate for UI / hasMore — not the stay-cursor padding. */
function virtualMultiCountryPages(countries: string[]): number {
  let knownSum = 0;
  let unknown = 0;
  for (const cc of countries) {
    const pages = imCountryCoverage.get(cc)?.totalPages;
    if (pages && pages > 0) knownSum += pages;
    else unknown += 1;
  }
  return Math.max(1, knownSum + Math.max(unknown, 1));
}

function mapMultiCountryPage(
  countries: string[],
  globalPage: number,
): { cc: string; listPage: number; countryIndex: number } | null {
  let offset = 0;
  for (let i = 0; i < countries.length; i++) {
    const cc = countries[i]!;
    const pages = imCountryCoverage.get(cc)?.totalPages ?? REST_STAY_PAGES;
    if (globalPage <= offset + pages) {
      return { cc, listPage: globalPage - offset, countryIndex: i };
    }
    offset += pages;
  }
  return null;
}

function rememberImCoverage(cc: string, pagination: PaginationInfo, listingCount: number): void {
  const pageSize = Math.max(listingCount, 1);
  const total = pagination.resultTotal;
  const totalPages =
    pagination.totalPages ??
    (total != null ? Math.max(1, Math.ceil(total / Math.max(pageSize, 30))) : undefined);
  if (total == null && totalPages == null) return;
  const prev = imCountryCoverage.get(cc);
  imCountryCoverage.set(cc, {
    total: Math.max(prev?.total ?? 0, total ?? 0),
    pageSize: prev?.pageSize && prev.pageSize >= 30 ? prev.pageSize : Math.max(pageSize, 30),
    totalPages: Math.max(prev?.totalPages ?? 0, totalPages ?? 0),
  });
}

/** Seed sticky coverage from crawl_state after resume (survives process restart). */
export function seedImportMotorCountryCoverage(
  cc: string,
  input: { total?: number; totalPages?: number; pageSize?: number },
): void {
  const code = cc.trim().toLowerCase();
  if (!code || code === "*rest") return;
  const prev = imCountryCoverage.get(code);
  const pageSize = Math.max(input.pageSize ?? prev?.pageSize ?? 30, 30);
  const total = Math.max(prev?.total ?? 0, input.total ?? 0);
  const totalPages = Math.max(
    prev?.totalPages ?? 0,
    input.totalPages ?? 0,
    total > 0 ? Math.ceil(total / pageSize) : 0,
  );
  if (total <= 0 && totalPages <= 0) return;
  imCountryCoverage.set(code, { total, pageSize, totalPages });
}

/** Alias — sticky coverage map is shared for country codes and brand slugs. */
export const seedImportMotorListCoverage = seedImportMotorCountryCoverage;

function countryListUrl(cc: string, page: number): string {
  if (page <= 1) return `${IMPORT_MOTOR_WEB_BASE}/buyer-locations/${cc}`;
  return `${IMPORT_MOTOR_WEB_BASE}/buyer-locations/${cc}?page=${page}`;
}

function brandListUrl(brand: string, page: number): string {
  if (page <= 1) return `${IMPORT_MOTOR_WEB_BASE}/${brand}`;
  return `${IMPORT_MOTOR_WEB_BASE}/${brand}?page=${page}`;
}

function normalizeCountryFilter(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const codes = raw
    .map((v) => String(v).trim().toLowerCase())
    .filter((cc) => cc === REST_TOKEN || /^[a-z]{2}$/.test(cc));
  return codes.length > 0 ? [...new Set(codes)] : undefined;
}

function normalizeFullCrawlCountries(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(
    raw
      .map((v) => String(v).trim().toLowerCase())
      .filter((cc) => cc === REST_TOKEN || /^[a-z]{2}$/.test(cc)),
  );
}

export class ImportMotorHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "import_motor";
  private countries: string[] = [];
  private brands: string[] = [];
  private countryFilter: string[] | undefined;
  private brandFilter: string[] | undefined;
  private crawlMode: "brands" | "countries";
  /** When set, list cards with a clear non-matching originHint are skipped (fast Korean scan). */
  readonly allowedOrigins: ImportMotorOrigin[] | undefined;
  /** Prefer-mode only skips list cards; opened detail pages are always persisted. */
  readonly preferOriginsOnly: boolean;

  constructor(baseUrl?: string, filters: ImportMotorFilterParams = {}) {
    super(baseUrl, filters);
    this.countryFilter = normalizeCountryFilter(filters.countries);
    this.brandFilter = normalizeBrandSlugs(filters.brands);
    const mode = filters.crawlMode;
    this.crawlMode =
      mode === "countries"
        ? "countries"
        : mode === "brands" || (this.brandFilter?.length ?? 0) > 0
          ? "brands"
          : "countries";
    const fullCrawl =
      Boolean(filters.fullCrawl) ||
      (filters.countries ?? []).some((cc) => normalizeFullCrawlCountries(filters.fullCrawlCountries).has(String(cc)));
    this.allowedOrigins = fullCrawl ? undefined : normalizeImportMotorOrigins(filters.origins);
    this.preferOriginsOnly = Boolean(this.allowedOrigins?.length);
  }

  allowsOrigin(origin: string | undefined | null): boolean {
    return originAllowed(origin, this.allowedOrigins);
  }

  protected extractSourceId(url: string): string | undefined {
    return url.match(/\/v\/([A-HJ-NPR-Z0-9]{17})/i)?.[1]?.toUpperCase();
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await importMotorGet(url);
    return {
      url: fetched.url,
      html: fetched.text,
      statusCode: fetched.status,
      headers: {},
    };
  }

  /**
   * Brand mode: one discover page = one /{brand}?page=N list page.
   * Country mode: one discover page = one /buyer-locations/{cc}?page=N list page.
   */
  async discoverListings(page: number): Promise<KrDiscoverResult> {
    if (this.crawlMode === "brands") {
      if (this.brands.length === 0) {
        this.brands =
          this.brandFilter?.length ? [...this.brandFilter] : [...IMPORT_MOTOR_BRAND_PRIORITY];
      }
      if (this.brands.length === 0) {
        throw new KrRequestError(
          502,
          "import-motor brand crawl has 0 brands configured",
          `${IMPORT_MOTOR_WEB_BASE}/`,
        );
      }
      if (this.brands.length > 1) {
        // Multi-brand without shards: map global page across brands (rare — worker uses 1 brand/shard).
        return this.discoverMultiBrandListPage(page);
      }
      return this.discoverBrandListPage(this.brands[0]!, Math.max(1, page));
    }

    if (this.countries.length === 0) {
      // Explicit country shards must not depend on /buyer-locations (CF often blanks it).
      if (
        this.countryFilter?.length &&
        !this.countryFilter.includes(REST_TOKEN)
      ) {
        this.countries = [...this.countryFilter];
      } else {
        this.countries = await this.loadCountries();
      }
      if (this.countries.length === 0) {
        throw new KrRequestError(
          502,
          "import-motor buyer-locations returned 0 countries — Cloudflare or layout change",
          `${IMPORT_MOTOR_WEB_BASE}/buyer-locations`,
        );
      }
    }

    // Multi-country (*rest): one discover page = one list page (not a whole-country dump).
    if (this.countries.length > 1) {
      return this.discoverMultiCountryListPage(page);
    }

    const cc = this.countries[0]!;
    return this.discoverCountryListPage(cc, Math.max(1, page));
  }

  private async discoverBrandListPage(brand: string, listPage: number): Promise<KrDiscoverResult> {
    const listUrl = brandListUrl(brand, listPage);
    const fetched = await importMotorGet(listUrl);
    if (/just a moment|attention required|cf-challenge-running/i.test(fetched.text.slice(0, 8_000))) {
      throw new KrRequestError(
        403,
        `Import Motor Cloudflare challenge on ${brand} list page ${listPage} — refresh IMPORT_MOTOR_COOKIE / pass CF in debug Chrome`,
        listUrl,
      );
    }
    const seen = new Set<string>();
    const listings: ListingReference[] = [];
    this.collectVinRefs(fetched.text, seen, listings);

    const sticky = imCountryCoverage.get(brand) ?? null;
    let pagination = brandListPagination(fetched.text, brand, listPage, listings.length, sticky);
    if (pagination.resultTotal != null && pagination.resultTotal > 0) {
      const pageSize = Math.max(listings.length, 1);
      imCountryCoverage.set(brand, {
        total: pagination.resultTotal,
        pageSize: Math.max(pageSize, 30),
        totalPages: Math.max(1, Math.ceil(pagination.resultTotal / Math.max(pageSize, 30))),
      });
    } else if (pagination.hasMore && listings.length > 0) {
      // Brand catalogs without "Showing X of Z": keep walking; do not freeze a tiny pager max.
      const prev = imCountryCoverage.get(brand);
      imCountryCoverage.set(brand, {
        total: prev?.total ?? 0,
        pageSize: Math.max(prev?.pageSize ?? 30, listings.length, 30),
        totalPages: Math.max(prev?.totalPages ?? 0, listPage + 1),
      });
    } else {
      rememberImCoverage(brand, pagination, listings.length);
    }
    const known = imCountryCoverage.get(brand);

    if (known && listings.length > 0) {
      pagination = brandListPagination(fetched.text, brand, listPage, listings.length, known);
      if (known.totalPages > 0 && listPage < known.totalPages && pagination.hasMore) {
        pagination = {
          ...pagination,
          hasMore: true,
          totalPages: Math.max(pagination.totalPages ?? 0, known.totalPages),
          resultTotal: Math.max(pagination.resultTotal ?? 0, known.total),
        };
      }
    }

    if (listings.length === 0 && !pagination.hasMore) {
      return { listings, pagination: { ...pagination, hasMore: false } };
    }

    if (
      listings.length === 0 &&
      known != null &&
      known.totalPages > 0 &&
      listPage < known.totalPages &&
      pagination.hasMore
    ) {
      throw new KrRequestError(
        502,
        `Import Motor ${brand} list page ${listPage}/${known.totalPages} returned 0 VINs (expected catalog size ${known.total})`,
        listUrl,
      );
    }

    return { listings, pagination };
  }

  private async discoverMultiBrandListPage(globalPage: number): Promise<KrDiscoverResult> {
    const mapped = mapMultiCountryPage(this.brands, Math.max(1, globalPage));
    if (!mapped) {
      return {
        listings: [],
        pagination: { currentPage: globalPage, totalPages: globalPage, hasMore: false },
      };
    }
    const result = await this.discoverBrandListPage(mapped.cc, mapped.listPage);
    const totalVirtual = virtualMultiCountryPages(this.brands);
    const hasMore =
      Boolean(result.pagination.hasMore) ||
      mapped.countryIndex < this.brands.length - 1 ||
      globalPage < totalVirtual;

    return {
      listings: result.listings,
      pagination: {
        currentPage: globalPage,
        totalPages: Math.max(totalVirtual, globalPage + (hasMore ? 1 : 0)),
        hasMore,
        resultTotal: result.pagination.resultTotal,
      },
    };
  }

  private async discoverCountryListPage(cc: string, listPage: number): Promise<KrDiscoverResult> {
    const listUrl = countryListUrl(cc, listPage);
    const fetched = await importMotorGet(listUrl);
    if (/just a moment|attention required|cf-challenge-running/i.test(fetched.text.slice(0, 8_000))) {
      throw new KrRequestError(
        403,
        `Import Motor Cloudflare challenge on ${cc} list page ${listPage} — refresh IMPORT_MOTOR_COOKIE / pass CF in debug Chrome`,
        listUrl,
      );
    }
    const seen = new Set<string>();
    const listings: ListingReference[] = [];
    this.collectVinRefs(fetched.text, seen, listings);

    const sticky = imCountryCoverage.get(cc) ?? null;
    let pagination = countryListPagination(fetched.text, cc, listPage, listings.length, sticky);
    // If this HTML has a real Showing window, overwrite inflated sticky page counts.
    if (pagination.resultTotal != null && pagination.resultTotal > 0) {
      const pageSize = Math.max(listings.length, 1);
      imCountryCoverage.set(cc, {
        total: pagination.resultTotal,
        pageSize: Math.max(pageSize, 30),
        totalPages: Math.max(1, Math.ceil(pagination.resultTotal / Math.max(pageSize, 30))),
      });
    } else {
      rememberImCoverage(cc, pagination, listings.length);
    }
    const known = imCountryCoverage.get(cc);

    if (known && listings.length > 0) {
      pagination = countryListPagination(fetched.text, cc, listPage, listings.length, known);
      if (known.totalPages > 0 && listPage < known.totalPages && pagination.hasMore) {
        pagination = {
          ...pagination,
          hasMore: true,
          totalPages: Math.max(pagination.totalPages ?? 0, known.totalPages),
          resultTotal: Math.max(pagination.resultTotal ?? 0, known.total),
        };
      }
    }

    if (listings.length === 0 && !pagination.hasMore) {
      return { listings, pagination: { ...pagination, hasMore: false } };
    }

    if (
      listings.length === 0 &&
      known != null &&
      known.totalPages > 0 &&
      listPage < known.totalPages &&
      pagination.hasMore
    ) {
      throw new KrRequestError(
        502,
        `Import Motor ${cc} list page ${listPage}/${known.totalPages} returned 0 VINs (expected catalog size ${known.total})`,
        listUrl,
      );
    }

    return { listings, pagination };
  }

  /**
   * Walk every *rest country list page without dumping an entire country in one discover call.
   * Global page maps onto (country, listPage) using sticky coverage totals.
   */
  private async discoverMultiCountryListPage(globalPage: number): Promise<KrDiscoverResult> {
    const mapped = mapMultiCountryPage(this.countries, Math.max(1, globalPage));
    if (!mapped) {
      return {
        listings: [],
        pagination: { currentPage: globalPage, totalPages: globalPage, hasMore: false },
      };
    }

    const result = await this.discoverCountryListPage(mapped.cc, mapped.listPage);
    const totalVirtual = virtualMultiCountryPages(this.countries);
    const hasMore =
      Boolean(result.pagination.hasMore) ||
      mapped.countryIndex < this.countries.length - 1 ||
      globalPage < totalVirtual;

    return {
      listings: result.listings,
      pagination: {
        currentPage: globalPage,
        totalPages: Math.max(totalVirtual, globalPage + (hasMore ? 1 : 0)),
        hasMore,
        resultTotal: result.pagination.resultTotal,
      },
    };
  }

  /** Legacy: one discover page = every list page of one country (unused by shards). */
  private async discoverWholeCountry(page: number): Promise<KrDiscoverResult> {
    const totalPages = Math.max(1, this.countries.length);
    const cc = this.countries[page - 1];
    if (!cc) {
      return { listings: [], pagination: { currentPage: page, totalPages, hasMore: false } };
    }
    const listings = await this.loadCountryAllPages(cc);
    return {
      listings,
      pagination: {
        currentPage: page,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const listing = parseImportMotorDetail(html, fetched.url);
    return attachImportMotorSpinPhotos(listing, html);
  }

  private async loadCountries(): Promise<string[]> {
    const fetched = await importMotorGet(`${IMPORT_MOTOR_WEB_BASE}/buyer-locations`);
    let codes = extractCountryCodes(fetched.text);
    if (codes.length < 50) {
      const retry = await importMotorGet(`${IMPORT_MOTOR_WEB_BASE}/buyer-locations`);
      const again = extractCountryCodes(retry.text);
      if (again.length > codes.length) codes = again;
    }
    for (const must of ["al", "us"] as const) {
      if (!codes.includes(must)) codes.push(must);
    }
    let ordered = prioritizeCountries(codes);

    if (this.countryFilter?.length) {
      if (this.countryFilter.includes(REST_TOKEN)) {
        const priority = new Set(IMPORT_MOTOR_COUNTRY_PRIORITY);
        return ordered.filter((cc) => !priority.has(cc));
      }
      // Trust explicit filters even when the index HTML omitted a code (CF/partial).
      return this.countryFilter.filter((cc) => cc !== REST_TOKEN);
    }
    return ordered;
  }

  private async loadCountryAllPages(cc: string): Promise<ListingReference[]> {
    const seen = new Set<string>();
    const listings: ListingReference[] = [];
    let page = 1;
    const hardCap = 100_000;

    while (page <= hardCap) {
      const fetched = await importMotorGet(countryListUrl(cc, page));
      const before = listings.length;
      this.collectVinRefs(fetched.text, seen, listings);
      const added = listings.length - before;
      const sticky = imCountryCoverage.get(cc) ?? null;
      let pagination = countryListPagination(fetched.text, cc, page, Math.max(added, 1), sticky);
      rememberImCoverage(cc, pagination, Math.max(added, 1));
      const known = imCountryCoverage.get(cc);
      if (known && page < known.totalPages) {
        pagination = { ...pagination, hasMore: true, totalPages: known.totalPages, resultTotal: known.total };
      }

      if (added === 0 && pagination.hasMore) {
        throw new KrRequestError(
          502,
          `Import Motor ${cc} list page ${page} empty while catalog incomplete`,
          countryListUrl(cc, page),
        );
      }
      if (!pagination.hasMore) break;
      page += 1;
    }

    return listings;
  }

  private collectVinRefs(html: string, seen: Set<string>, out: ListingReference[]): void {
    const push = (vinOrUrl: string, href: string, around: string) => {
      const url = extractImportMotorVinUrl(href) ?? (vinOrUrl.startsWith("http") ? vinOrUrl : undefined);
      if (!url || seen.has(url)) return;
      const vin = this.extractSourceId(url);
      if (!vin) return;
      const originHint = guessImportMotorOriginFromSnippet(around);
      // Korean-only mode: drop clearly-US list cards without a detail fetch.
      if (this.allowedOrigins?.length && originHint && !originAllowed(originHint, this.allowedOrigins)) {
        seen.add(url);
        return;
      }
      seen.add(url);
      out.push({
        sourceId: vin,
        url,
        metadata: originHint ? { originHint } : undefined,
      });
    };

    for (const m of html.matchAll(/href="([^"]*\/v\/[A-HJ-NPR-Z0-9]{17}[^"]*)"/gi)) {
      const href = m[1]!;
      const idx = m.index ?? 0;
      const around = html.slice(Math.max(0, idx - 1200), Math.min(html.length, idx + 1800));
      push(href, href, around);
    }
    for (const m of html.matchAll(/https?:\/\/(?:www\.)?import-motor\.com\/v\/([A-HJ-NPR-Z0-9]{17})/gi)) {
      const vin = m[1]!.toUpperCase();
      const url = `${IMPORT_MOTOR_WEB_BASE}/v/${vin}`;
      if (seen.has(url)) continue;
      const idx = m.index ?? 0;
      const around = html.slice(Math.max(0, idx - 1200), Math.min(html.length, idx + 1800));
      push(vin, url, around);
    }
  }
}
