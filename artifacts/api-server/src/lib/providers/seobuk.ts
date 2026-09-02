import { load } from "cheerio";
import type { FetchedListing, ListingReference, NormalizedListing } from "@workspace/providers";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch } from "./kr-http";
import {
  absUrl,
  collectImgs,
  findVinInText,
  normalizeKrVin,
  parseKm,
  parseMoney,
  parseYear,
  specFromTable,
  usdListing,
  vehicleFromParts,
} from "./kr-common";
import type { NormalizedPhoto } from "@workspace/providers";

export const SEOBUK_PARSER_VERSION = "seobuk-v1.2.0";
export const SEOBUK_WEB_BASE = "https://www.seobuk.org";

export function seobukDetailUrl(id: string): string {
  return `${SEOBUK_WEB_BASE}/search/detail/${id}`;
}

const SEOBUK_GALLERY_SCOPES = [
  "#car_image",
  ".car_img",
  ".car_image",
  ".car_slide",
  ".slide_area",
  ".photo_area",
  ".car_detail_img",
  ".detail_img",
  ".car_photo",
  ".swiper-wrapper",
];

export function isSeobukJunkPhoto(url: string): boolean {
  return (
    /\/(?:common|assets|css|js|static)\//i.test(url) ||
    /\/img\/(?:logo|icon|banner|btn|sns|social|payment|footer|header|cert|qr)/i.test(url) ||
    /\/logo[\.\/_-]|favicon|blank[_-]?photo|no[_-]?image|default\.webp|placeholder/i.test(url) ||
    /visa|mastercard|paypal|mailchimp|mcusercontent|sprite|badge|avatar/i.test(url) ||
    /\.gif(\?|$)/i.test(url)
  );
}

/** Vehicle gallery only — avoids site logos/icons from full-page img scan. */
function collectSeobukPhotos(
  $: ReturnType<typeof load>,
  mainImg?: string | null,
): NormalizedPhoto[] {
  const urls: string[] = [];
  const push = (raw?: string | null) => {
    const url = absUrl(SEOBUK_WEB_BASE, raw);
    if (!url || url.startsWith("data:")) return;
    if (/\.(svg)(\?|$)/i.test(url)) return;
    if (isSeobukJunkPhoto(url)) return;
    if (urls.includes(url)) return;
    urls.push(url);
  };

  if (mainImg) push(mainImg);

  $("#main_img, input[name*='img'], input[id*='img']").each((_, el) => {
    push($(el).attr("value") ?? $(el).attr("data-src") ?? $(el).attr("data-img"));
  });

  for (const sel of SEOBUK_GALLERY_SCOPES) {
    $(sel)
      .find("img")
      .each((_, el) => {
        push($(el).attr("src") ?? $(el).attr("data-src") ?? $(el).attr("data-img"));
      });
  }

  // Fallback: scoped collectImgs (excludes similar/recommended blocks).
  if (urls.length <= 1) {
    for (const sel of SEOBUK_GALLERY_SCOPES) {
      if ($(sel).length === 0) continue;
      for (const p of collectImgs($, SEOBUK_WEB_BASE, [], { scope: sel })) {
        push(p.sourceUrl);
      }
    }
  }

  return urls.slice(0, 40).map((sourceUrl, index) => ({
    sourceUrl,
    isPrimary: index === 0,
    sortOrder: index,
  }));
}

export class SeobukHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "seobuk";

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    const url =
      `${SEOBUK_WEB_BASE}/search/model/all/${page}` +
      `?order=&ascending=desc&view=image&customSelect=24&country=all&tab=model`;
    const fetched = await krFetch(url, { referer: `${SEOBUK_WEB_BASE}/search/model/all` });
    const $ = load(fetched.text);
    const seen = new Set<string>();
    const listings: ListingReference[] = [];
    $('a[href*="/search/detail/"]').each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const id = href.match(/\/search\/detail\/([A-F0-9]{32})/i)?.[1]?.toUpperCase();
      if (!id || seen.has(id)) return;
      seen.add(id);
      listings.push({ sourceId: id, url: seobukDetailUrl(id) });
    });
    const pagerPages = [...fetched.text.matchAll(/\/search\/model\/all\/(\d+)/g)]
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n) && n > 0);
    const totalPages = Math.max(page, ...pagerPages, listings.length >= 24 ? page + 1 : page);
    return {
      listings,
      pagination: {
        currentPage: page,
        totalPages,
        hasMore: listings.length >= 24 || (listings.length > 0 && page < totalPages),
      },
    };
  }

  protected extractSourceId(url: string): string | undefined {
    return url.match(/\/search\/detail\/([A-F0-9]{32})/i)?.[1]?.toUpperCase();
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const $ = load(fetched.html ?? "");
    const sourceId =
      $("#car-no").attr("data-car-no")?.toUpperCase() ||
      this.extractSourceId(fetched.url) ||
      "unknown";
    const title = $("title").first().text().replace(/\s+/g, " ").trim() || $(".car_name p").first().text().trim();
    const make = title.match(/\[([^\]]+)\]/)?.[1]?.trim();
    const model = specFromTable($, "Model name") || $("#car-name").text().trim();
    const year = parseYear(specFromTable($, "Vehicle year"));
    const mileage = parseKm(specFromTable($, "Mileage"));
    const price = parseMoney($(".car_price .representativeColor").first().text());
    const vin = normalizeKrVin(specFromTable($, "Vehicle identification number")) || findVinInText(fetched.html ?? "");
    const plate = $("#car-no").attr("data-car-plate-number") || specFromTable($, "The car's number");
    const vehicle = vehicleFromParts({
      vin,
      make,
      model,
      year,
      fuelType: specFromTable($, "Fuel"),
      transmission: specFromTable($, "Transmission"),
      color: specFromTable($, "Color"),
    });
    const mainImg = $("#main_img").attr("value");
    return usdListing({
      sourceId,
      sourceUrl: seobukDetailUrl(sourceId),
      title,
      price,
      mileage,
      location: plate,
      vehicle,
      photos: collectSeobukPhotos($, mainImg),
    });
  }
}
