/**
 * Fetch live pages and dump field signals for EU providers (no TS adapter import).
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function get(url, headers = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*", ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(25000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "";
  const charset = (ct.match(/charset=([\w-]+)/i)?.[1] || "utf-8").toLowerCase();
  let text;
  try {
    text = charset.includes("utf") ? buf.toString("utf8") : new TextDecoder(charset).decode(buf);
  } catch {
    text = buf.toString("utf8");
  }
  return { status: res.status, url: res.url, ct, charset, text };
}

function nextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function deepFind(obj, pred, path = "", out = [], depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 12 || out.length > 40) return out;
  if (Array.isArray(obj)) {
    obj.slice(0, 30).forEach((v, i) => deepFind(v, pred, `${path}[${i}]`, out, depth + 1));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (pred(k, v, p)) out.push({ path: p, key: k, value: typeof v === "string" ? v.slice(0, 120) : v });
    if (v && typeof v === "object") deepFind(v, pred, p, out, depth + 1);
  }
  return out;
}

console.log("=== standvirtual list ===");
{
  const r = await get("https://www.standvirtual.com/carros?search%5Border%5D=created_at_first%3Adesc&page=1", {
    "Accept-Language": "pt-PT,pt;q=0.9",
    Cookie: "language=en; lang=en",
  });
  const links = [...r.text.matchAll(/href="(https:\/\/(?:www\.)?standvirtual\.com\/carros\/anuncio\/[^"?]+)"/g)].map(
    (m) => m[1].split("?")[0],
  );
  console.log("status", r.status, "links", new Set(links).size);
  const detailUrl = [...new Set(links)][0];
  if (detailUrl) {
    const d = await get(detailUrl, { "Accept-Language": "pt-PT,pt;q=0.9", Cookie: "language=en; lang=en" });
    const next = nextData(d.text);
    const advert = next?.props?.pageProps?.advert;
    console.log("detail", d.status, detailUrl.slice(0, 80));
    if (advert) {
      const dict = advert.parametersDict || {};
      const keys = Object.keys(dict);
      console.log("dict keys sample", keys.slice(0, 25));
      for (const k of ["vin", "mileage", "year", "first_registration_year", "make", "model", "fuel_type"]) {
        const rec = dict[k];
        const val = rec?.values?.[0];
        console.log(`  dict.${k}=`, val?.label ?? val?.value ?? rec);
      }
      console.log("price", advert.price);
      console.log("details arr", (advert.details || []).slice(0, 8));
      console.log("mainFeatures", advert.mainFeatures);
      console.log("images", advert.images?.photos?.length, advert.images?.photos?.[0]?.url?.slice?.(0, 80));
    } else {
      console.log("no advert in NEXT_DATA; len", d.text.length, "has next", !!next);
      const yearHits = deepFind(next, (k) => /year|registration|ano/i.test(k)).slice(0, 15);
      console.log("year-ish", yearHits);
    }
  }
}

console.log("\n=== mobile.bg detail from prod-like URL ===");
{
  const url =
    "https://www.mobile.bg/obiava-21783411745471022-mercedes-benz-glc-220-d-nalichna-amg-line-4matic";
  const r = await get(url, { "Accept-Language": "bg-BG,bg;q=0.9" });
  console.log("status", r.status, "charset", r.charset, "ct", r.ct);
  const title = r.text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  console.log("title", title?.slice(0, 100));
  const price = r.text.match(/class="Price"[^>]*>([\s\S]{0,200})/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  console.log("price block", price?.slice(0, 120));
  const labels = [...r.text.matchAll(/class="mpLabel">([\s\S]*?)<\/div>\s*<div class="mpInfo">([\s\S]*?)<\/div>/gi)].map(
    (m) => [m[1].replace(/<[^>]+>/g, "").trim(), m[2].replace(/<[^>]+>/g, "").trim()],
  );
  console.log("params", labels.slice(0, 15));
  const mojibake = /Ð|Ñ|Ã/.test(r.text.slice(0, 5000));
  console.log("mojibake?", mojibake, "has пробег?", /пробег/i.test(r.text), "has Ð¿Ñ€Ð¾Ð±ÐµÐ³?", /Ð¿Ñ€Ð¾Ð±ÐµÐ³/.test(r.text));
}

console.log("\n=== subito discover ===");
{
  const r = await get("https://www.subito.it/annunci-italia/vendita/auto/?o=1", {
    "Accept-Language": "it-IT,it;q=0.9",
  });
  const next = nextData(r.text);
  const items = next?.props?.pageProps?.initialState?.items;
  console.log("status", r.status, "originalList", items?.originalList?.length, "keys", items && Object.keys(items));
  const first = items?.originalList?.find((x) => x?.urls?.default);
  if (first) {
    console.log("sample", first.subject, first.urls?.default);
    const d = await get(first.urls.default, { "Accept-Language": "it-IT,it;q=0.9" });
    const dn = nextData(d.text);
    const ad =
      dn?.props?.pageProps?.ad ||
      dn?.props?.pageProps?.initialState?.item ||
      dn?.props?.pageProps?.initialState?.ad;
    console.log("detail status", d.status, "ad keys", ad && Object.keys(ad).slice(0, 20));
    if (ad?.features) {
      for (const k of Object.keys(ad.features).slice(0, 12)) {
        const f = ad.features[k];
        console.log(" ", k, f?.values?.[0]);
      }
    }
    console.log("images", ad?.images?.length);
  }
}

console.log("\n=== automobile.it /usate ===");
{
  const r = await get("https://www.automobile.it/usate", { "Accept-Language": "it-IT,it;q=0.9" });
  const next = nextData(r.text);
  const result =
    next?.props?.pageProps?.result ||
    next?.props?.pageProps?.apiResults?.result ||
    next?.props?.pageProps?.apiResults;
  console.log("status", r.status, "resultList", result?.resultList?.length, "page", result?.page);
  const first = result?.resultList?.[0];
  if (first) {
    console.log("sample", first.id, first.url, first.title);
    const d = await get("https://www.automobile.it" + (first.url.startsWith("/") ? first.url : "/" + first.url), {
      "Accept-Language": "it-IT,it;q=0.9",
    });
    const dn = nextData(d.text);
    const res = dn?.props?.pageProps?.result;
    const vi = dn?.props?.pageProps?.vehicleInformation;
    console.log("detail", d.status, "title", res?.title, "km", res?.details?.formattedKm, "reg", res?.details?.registration);
    console.log("basicInfo", vi?.basicInfo?.slice?.(0, 8));
    console.log("pics", res?.pictures?.length || res?.imageUrls?.length);
  } else {
    console.log("pageProps keys", next?.props?.pageProps && Object.keys(next.props.pageProps));
  }
}

console.log("\n=== autoscout24.be detail ===");
{
  const url =
    "https://www.autoscout24.be/fr/offres/audi-q2-30-tfsi-navi-zetelverwarming-essence-noir-cat";
  // need full URL from prod - fetch list instead
  const list = await get("https://www.autoscout24.be/fr/lst?atype=C&cy=B&sort=age&desc=1&ustate=N%2CU&page=1");
  const next = nextData(list.text);
  const listings = next?.props?.pageProps?.listings || [];
  console.log("list status", list.status, "listings", listings.length, "bot?", /captcha|challenge|datadome|cloudflare/i.test(list.text));
  const first = listings[0];
  if (first) {
    const path = first.url || first.listingUrl;
    const detailUrl = path?.startsWith("http") ? path : `https://www.autoscout24.be${path}`;
    const d = await get(detailUrl);
    const dn = nextData(d.text);
    const details = dn?.props?.pageProps?.listingDetails || dn?.props?.pageProps?.listing;
    console.log("detail", d.status, detailUrl.slice(0, 90));
    console.log("prices", JSON.stringify(details?.prices)?.slice(0, 400));
    console.log("mileage", details?.vehicle?.mileageInKm ?? details?.vehicle?.mileage);
    console.log("year", details?.vehicle?.firstRegistrationDate, details?.vehicle?.modelYear);
    console.log("images", details?.images?.length || details?.gallery?.length);
    const priceHits = deepFind(details, (k) => /price/i.test(k)).slice(0, 20);
    console.log("price paths", priceHits.map((x) => `${x.path}=${JSON.stringify(x.value).slice(0, 60)}`));
  } else {
    console.log("pageProps", next?.props?.pageProps && Object.keys(next.props.pageProps));
    console.log("html slice", list.text.slice(0, 300).replace(/\s+/g, " "));
  }
}
