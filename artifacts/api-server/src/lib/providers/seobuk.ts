import { load } from "cheerio";
import type { FetchedListing, ListingReference, NormalizedEvent, NormalizedListing, NormalizedPhoto } from "@workspace/providers";
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
import { firstRegEvent } from "./web-html";

export const SEOBUK_PARSER_VERSION = "seobuk-v1.3.1";
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
  ".img-wrap",
  ".img-more",
  ".thumnail",
  ".thumbnail",
  "#photo",
  ".photo_list",
  ".gallery",
];

const CARMANAGER_PHOTO_RE =
  /https?:\\?\/\\?\/(?:www\.)?(?:img|myshop-img\d*)\.carmanager\.co\.kr(?:\\?\/(?:temp\\?\/)?photo\\?\/)[^\s"'<>]+?\.(?:jpe?g|png|webp)/gi;
const SEOBUK_USER_PHOTO_RE =
  /https?:\\?\/\\?\/(?:www\.)?seobuk\.org(?:\\?\/assets\\?\/admin\\?\/images\\?\/user\\?\/)[^\s"'<>]+?\.(?:jpe?g|png|webp)/gi;

export function isSeobukGalleryPhoto(url: string): boolean {
  return (
    /(?:img|myshop-img\d*)\.carmanager\.co\.kr\/(?:temp\/)?photo\//i.test(url) ||
    /seobuk\.org\/assets\/admin\/images\/user\/[^?\s]+\/se\//i.test(url)
  );
}

export function isSeobukJunkPhoto(url: string): boolean {
  if (isSeobukGalleryPhoto(url)) return false;
  return (
    /\/(?:common|assets|css|js|static)\//i.test(url) ||
    /\/img\/(?:logo|icon|banner|btn|sns|social|payment|footer|header|cert|qr)/i.test(url) ||
    /\/logo[\.\/_-]|_logo|logo_|logo\.|favicon|blank[_-]?photo|no[_-]?image|default\.webp|placeholder/i.test(url) ||
    /myshop-img\d*\.carmanager\.co\.kr/i.test(url) ||
    /visa|mastercard|paypal|mailchimp|mcusercontent|sprite|badge|avatar/i.test(url) ||
    /\.gif(\?|$)/i.test(url) ||
    /_TH\.(jpe?g|png|webp)(\?|$)/i.test(url)
  );
}

function unescapeSeobukUrl(raw: string): string {
  return raw
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Collapse Carmanager CDN host aliases to one identity. */
function canonicalizeSeobukPhotoUrl(url: string): string {
  return url.replace(
    /\/\/(?:www\.)?(?:img|myshop-img\d*)\.carmanager\.co\.kr\//i,
    "//img.carmanager.co.kr/",
  );
}

const PHOTO_ATTRS = ["src", "data-src", "data-original", "data-lazy", "data-img", "data-url", "href", "value"] as const;

/** Vehicle gallery only — keeps Carmanager + Seobuk user shots, drops chrome. */
export function collectSeobukPhotos(
  $: ReturnType<typeof load>,
  html: string,
  mainImg?: string | null,
): NormalizedPhoto[] {
  const urls: string[] = [];
  const push = (raw?: string | null) => {
    if (!raw) return;
    for (const part of unescapeSeobukUrl(raw).split(/[|,;\s]+/)) {
      let url = absUrl(SEOBUK_WEB_BASE, part);
      if (!url || url.startsWith("data:")) continue;
      url = canonicalizeSeobukPhotoUrl(url);
      if (/\.(svg)(\?|$)/i.test(url)) continue;
      if (isSeobukJunkPhoto(url)) continue;
      if (urls.includes(url)) continue;
      urls.push(url);
    }
  };

  if (mainImg) push(mainImg);

  $("#main_img, input[name*='img'], input[id*='img'], input[name*='photo'], input[id*='photo']").each((_, el) => {
    push($(el).attr("value") ?? $(el).attr("data-src") ?? $(el).attr("data-img"));
  });

  for (const sel of SEOBUK_GALLERY_SCOPES) {
    $(sel)
      .find("img, a, source, [data-src], [data-img]")
      .each((_, el) => {
        const node = $(el);
        for (const name of PHOTO_ATTRS) push(node.attr(name));
      });
  }

  $("a[href*='images/user'], a[href*='carmanager'], img[src*='images/user'], img[src*='carmanager'], img[data-src*='images/user'], img[data-src*='carmanager']").each(
    (_, el) => {
      const node = $(el);
      for (const name of PHOTO_ATTRS) push(node.attr(name));
    },
  );

  if (urls.length <= 1) {
    for (const sel of SEOBUK_GALLERY_SCOPES) {
      if ($(sel).length === 0) continue;
      for (const p of collectImgs($, SEOBUK_WEB_BASE, [], { scope: sel })) {
        push(p.sourceUrl);
      }
    }
  }

  for (const re of [CARMANAGER_PHOTO_RE, SEOBUK_USER_PHOTO_RE]) {
    re.lastIndex = 0;
    for (const match of html.matchAll(re)) {
      push(unescapeSeobukUrl(match[0]));
    }
  }

  return urls.slice(0, 40).map((sourceUrl, index) => ({
    sourceUrl,
    isPrimary: index === 0,
    sortOrder: index,
  }));
}

function pushUniquePhoto(urls: string[], raw?: string | null): void {
  if (!raw) return;
  for (const part of unescapeSeobukUrl(raw).split(/[|,;\s]+/)) {
    let url = absUrl(SEOBUK_WEB_BASE, part);
    if (!url || url.startsWith("data:")) continue;
    url = canonicalizeSeobukPhotoUrl(url);
    if (/\.(svg)(\?|$)/i.test(url)) continue;
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(url.split("?")[0] || "")) continue;
    if (isSeobukJunkPhoto(url)) continue;
    if (urls.includes(url)) continue;
    // Prefer full-size when a _TH thumb of the same shot already exists.
    const full = url.replace(/_TH\.(jpe?g|png|webp)(\?|$)/i, ".$1$2");
    if (full !== url && urls.includes(full)) continue;
    const thumbIdx = urls.findIndex((u) => u.replace(/_TH\.(jpe?g|png|webp)(\?|$)/i, ".$1$2") === url);
    if (thumbIdx >= 0) {
      urls[thumbIdx] = url;
      continue;
    }
    urls.push(url);
  }
}

/** Live gallery JSON used by Seobuk detail.js getCarImageList(). */
export async function fetchSeobukImageList(carNo: string): Promise<string[]> {
  const got = await krFetch(`${SEOBUK_WEB_BASE}/search/imageList`, {
    method: "POST",
    body: new URLSearchParams({ carNo }),
    referer: seobukDetailUrl(carNo),
    accept: "application/json, text/javascript, */*; q=0.01",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  let json: {
    info?: Array<Record<string, unknown>>;
    basic_image_url?: string;
  };
  try {
    json = JSON.parse(got.text) as typeof json;
  } catch {
    return [];
  }
  const urls: string[] = [];
  pushUniquePhoto(urls, json.basic_image_url);
  for (const row of json.info ?? []) {
    pushUniquePhoto(
      urls,
      String(row.CarImageFullName ?? row.carImageFullName ?? row.url ?? ""),
    );
  }
  return urls;
}

function asPhotos(urls: string[]): NormalizedPhoto[] {
  return urls.slice(0, 40).map((sourceUrl, index) => ({
    sourceUrl,
    isPrimary: index === 0,
    sortOrder: index,
  }));
}

function specAny($: ReturnType<typeof load>, ...labels: string[]): string | undefined {
  for (const label of labels) {
    const value = specFromTable($, label);
    if (value && value !== "-") return value;
  }
  return undefined;
}

function extraSpec(field: string, label: string, value?: string): NormalizedEvent | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text || text === "-") return undefined;
  return {
    eventType: "other",
    description: `${label}: ${text}`,
    occurredAt: new Date(),
    metadata: { field, value: text, source: "seobuk" },
  };
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
    const html = fetched.html ?? "";
    const $ = load(html);
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
    const vin = normalizeKrVin(specFromTable($, "Vehicle identification number")) || findVinInText(html);
    const plate = $("#car-no").attr("data-car-plate-number") || specFromTable($, "The car's number");
    const vehicle = vehicleFromParts({
      vin,
      make,
      model,
      year,
      trim: specAny($, "Trim", "Grade", "Package"),
      bodyType: specAny($, "Body type", "Body", "차종"),
      fuelType: specFromTable($, "Fuel"),
      transmission: specFromTable($, "Transmission"),
      driveType: specAny($, "Drivetrain", "Drive type", "Drive", "구동"),
      engineDisplacement: specAny($, "Displacement", "Engine displacement", "Engine", "배기량"),
      color: specFromTable($, "Color"),
    });
    const mainImg = $("#main_img").attr("value");
    const events: NormalizedEvent[] = [];
    const firstReg = firstRegEvent(specFromTable($, "Date of first registration"));
    if (firstReg) events.push(firstReg);
    for (const event of [
      extraSpec("seizure", "Seizure", specFromTable($, "Seizure")),
      extraSpec("mortgage", "Mortgage", specFromTable($, "Mortgage")),
      extraSpec("tax_arrears", "Tax arrears", specAny($, "Non-payment of tax", "Unpaid tax")),
      extraSpec("sales_method", "Sales method", specAny($, "판매방식", "Sales method")),
    ]) {
      if (event) events.push(event);
    }

    // Prefer live /search/imageList JSON (full gallery). HTML description often only
    // has 1–2 dealer stamp shots reused across listings.
    const photoUrls: string[] = [];
    let apiUrls: string[] = [];
    try {
      apiUrls = await fetchSeobukImageList(sourceId);
    } catch {
      apiUrls = [];
    }
    if (apiUrls.length >= 2) {
      for (const url of apiUrls) pushUniquePhoto(photoUrls, url);
      pushUniquePhoto(photoUrls, mainImg);
    } else {
      for (const photo of collectSeobukPhotos($, html, mainImg)) {
        pushUniquePhoto(photoUrls, photo.sourceUrl);
      }
      for (const url of apiUrls) pushUniquePhoto(photoUrls, url);
    }

    return usdListing({
      sourceId,
      sourceUrl: seobukDetailUrl(sourceId),
      title,
      price,
      mileage,
      location: plate,
      vehicle,
      photos: asPhotos(photoUrls),
      events,
    });
  }
}
