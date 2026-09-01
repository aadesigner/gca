/**
 * Korean marketplace adapters (charancha, autohub, lotteautoauction, …).
 * HTML list discovery + VIN-only persist when chassis is public on detail.
 */
import { load } from "cheerio";
import type { FetchedListing, ListingReference, NormalizedListing } from "@workspace/providers";
import { SOUTH_KOREA } from "../geo";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch } from "./kr-http";
import { moneyListing } from "./us-common";
import { asPhotos, collectHttpImages, firstRegEvent } from "./web-html";

type SiteConfig = {
  internalName: string;
  base: string;
  listUrl: (page: number) => string;
  listReferer?: string;
  hrefPatterns: RegExp[];
  idFromUrl: (url: string) => string | undefined;
  detailUrl: (id: string) => string;
};

function discoverFromHtml(config: SiteConfig, page: number): Promise<KrDiscoverResult> {
  return (async () => {
    const fetched = await krFetch(config.listUrl(page), {
      referer: config.listReferer ?? `${config.base}/`,
    });
    const seen = new Set<string>();
    const listings: ListingReference[] = [];
    const push = (id: string, url?: string) => {
      const sid = id.trim();
      if (!sid || seen.has(sid)) return;
      seen.add(sid);
      listings.push({
        sourceId: sid,
        url: url ?? config.detailUrl(sid),
      });
    };

    for (const pattern of config.hrefPatterns) {
      for (const match of fetched.text.matchAll(pattern)) {
        const href = match[1] ?? match[0];
        if (!href) continue;
        const abs = href.startsWith("http") ? href : `${config.base}${href.startsWith("/") ? "" : "/"}${href}`;
        const id = config.idFromUrl(abs) ?? config.idFromUrl(href);
        if (id) push(id, abs.split("?")[0]);
      }
    }

    return {
      listings,
      pagination: { currentPage: page, hasMore: listings.length >= 5 },
    };
  })();
}

function parseGenericKrListing(config: SiteConfig, fetched: FetchedListing): NormalizedListing {
  const $ = load(fetched.html ?? "");
  const html = fetched.html ?? "";
  const id = config.idFromUrl(fetched.url) ?? fetched.url;
  const vin = normalizeKrVin(findVinInText(html));
  const title = $("h1,h2,.car-title,.tit").first().text().replace(/\s+/g, " ").trim() || undefined;
  const mileage =
    parseKm(specFromTable($, "주행거리")) ??
    parseKm(specFromTable($, "Mileage")) ??
    parseKm(html.match(/([\d,]+)\s*km/i)?.[1]);
  const price =
    parseMoney(html.match(/(?:₩|KRW|원)\s*([\d,]+)/i)?.[1]) ??
    parseMoney($(".price,.car-price").first().text());
  const year = parseYear(title) ?? parseYear(html);

  return {
    ...moneyListing({
      sourceId: id,
      sourceUrl: fetched.url,
      title,
      price,
      priceCurrency: "KRW",
      mileage,
      country: SOUTH_KOREA,
      vehicle: vehicleFromParts({
        vin,
        make: specFromTable($, "제조사") ?? specFromTable($, "Maker"),
        model: specFromTable($, "모델") ?? specFromTable($, "Model"),
        year,
        fuelType: specFromTable($, "연료"),
        transmission: specFromTable($, "변속기"),
        color: specFromTable($, "색상"),
        country: SOUTH_KOREA,
      }),
      photos: asPhotos(collectHttpImages(html).slice(0, 40)),
      events: firstRegEvent(html),
    }),
  };
}

function makeAdapter(config: SiteConfig): new (baseUrl?: string, filters?: Record<string, unknown>) => KrHtmlAdapter {
  return class extends KrHtmlAdapter {
    readonly internalName = config.internalName;

    discoverListings(page: number) {
      return discoverFromHtml(config, page);
    }

    protected extractSourceId(url: string) {
      return config.idFromUrl(url);
    }

    async parseListing(fetched: FetchedListing) {
      return parseGenericKrListing(config, fetched);
    }
  };
}

const CHARANCHA: SiteConfig = {
  internalName: "charancha",
  base: "https://www.charancha.com",
  listUrl: (p) => `https://www.charancha.com/bu/search/list?page=${p}&sort=recent`,
  hrefPatterns: [
    /href=["']([^"']*\/bu\/detail\/[^"']+)["']/gi,
    /sellNo["']?\s*[:=]\s*["']?(\d{5,})/gi,
  ],
  idFromUrl: (url) => url.match(/\/detail\/(\d+)/)?.[1] ?? url.match(/sellNo=(\d+)/)?.[1],
  detailUrl: (id) => `https://www.charancha.com/bu/detail/${id}`,
};

const AUTOHUB: SiteConfig = {
  internalName: "autohub",
  base: "https://www.autohub.co.kr",
  listUrl: (p) => `https://www.autohub.co.kr/buy/searchKor.asp?page=${p}`,
  hrefPatterns: [/href=["']([^"']*\/buy\/[^"']+\.asp[^"']*)["']/gi],
  idFromUrl: (url) => url.match(/(?:carSeq|sellSeq|seq)=(\d+)/i)?.[1] ?? url.match(/\/buy\/(\d+)/)?.[1],
  detailUrl: (id) => `https://www.autohub.co.kr/buy/detail.asp?carSeq=${id}`,
};

const LOTTE_AUTO_AUCTION: SiteConfig = {
  internalName: "lotteautoauction",
  base: "https://www.lotteautoauction.net",
  listUrl: (p) => `https://www.lotteautoauction.net/auction/exhibitList.do?pageIndex=${p}`,
  hrefPatterns: [/href=["']([^"']*exhibitDetail[^"']*)["']/gi, /exhibitSeq["']?\s*[:=]\s*["']?(\d+)/gi],
  idFromUrl: (url) => url.match(/exhibitSeq=(\d+)/)?.[1] ?? url.match(/detail\/(\d+)/)?.[1],
  detailUrl: (id) => `https://www.lotteautoauction.net/auction/exhibitDetail.do?exhibitSeq=${id}`,
};

const AUTOINSIDE: SiteConfig = {
  internalName: "autoinside",
  base: "https://www.autoinside.co.kr",
  listUrl: (p) => `https://www.autoinside.co.kr/usedcar/list?page=${p}`,
  hrefPatterns: [/href=["']([^"']*\/usedcar\/(?:view|detail)[^"']*)["']/gi],
  idFromUrl: (url) => url.match(/(?:carSeq|seq|id)=(\d+)/i)?.[1],
  detailUrl: (id) => `https://www.autoinside.co.kr/usedcar/view?carSeq=${id}`,
};

const AUTOBELL_GLOBAL: SiteConfig = {
  internalName: "autobellglobal",
  base: "https://www.autobellglobal.com",
  listUrl: (p) => `https://www.autobellglobal.com/auction/list?page=${p}`,
  hrefPatterns: [/href=["']([^"']*\/auction\/(?:detail|view)[^"']*)["']/gi],
  idFromUrl: (url) => url.match(/(?:carId|auctionNo|seq)=(\w+)/i)?.[1],
  detailUrl: (id) => `https://www.autobellglobal.com/auction/detail?carId=${id}`,
};

const RBAUTOTRADE: SiteConfig = {
  internalName: "rbautotrade",
  base: "https://www.rbautotrade.com",
  listUrl: (p) => `https://www.rbautotrade.com/usedcar/list?page=${p}`,
  hrefPatterns: [/href=["']([^"']*\/usedcar\/[^"']+)["']/gi],
  idFromUrl: (url) => url.match(/(?:carSeq|id)=(\d+)/i)?.[1],
  detailUrl: (id) => `https://www.rbautotrade.com/usedcar/view?carSeq=${id}`,
};

const SENAAUTO: SiteConfig = {
  internalName: "senaauto",
  base: "https://www.senaauto.kr",
  listUrl: (p) => `https://www.senaauto.kr/car/list?page=${p}`,
  hrefPatterns: [/href=["']([^"']*\/car\/(?:view|detail)[^"']*)["']/gi],
  idFromUrl: (url) => url.match(/(?:carSeq|id)=(\d+)/i)?.[1],
  detailUrl: (id) => `https://www.senaauto.kr/car/view?carSeq=${id}`,
};

export const CHARANCHA_PARSER_VERSION = "charancha-v1.0.0";
export const AUTOHUB_PARSER_VERSION = "autohub-v1.0.0";
export const LOTTEAUTOAUCTION_PARSER_VERSION = "lotteautoauction-v1.0.0";
export const AUTOINSIDE_PARSER_VERSION = "autoinside-v1.0.0";
export const AUTOBELLGLOBAL_PARSER_VERSION = "autobellglobal-v1.0.0";
export const RBAUTOTRADE_PARSER_VERSION = "rbautotrade-v1.0.0";
export const SENAAUTO_PARSER_VERSION = "senaauto-v1.0.0";

export const CharanchaHistoricalAdapter = makeAdapter(CHARANCHA);
export const AutohubHistoricalAdapter = makeAdapter(AUTOHUB);
export const LotteautoauctionHistoricalAdapter = makeAdapter(LOTTE_AUTO_AUCTION);
export const AutoinsideHistoricalAdapter = makeAdapter(AUTOINSIDE);
export const AutobellglobalHistoricalAdapter = makeAdapter(AUTOBELL_GLOBAL);
export const RbautotradeHistoricalAdapter = makeAdapter(RBAUTOTRADE);
export const SenaautoHistoricalAdapter = makeAdapter(SENAAUTO);
