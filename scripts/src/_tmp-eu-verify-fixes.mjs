/** Verify charset + field extraction after fixes (no TS build needed). */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function fetchHtml(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...extraHeaders,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "";
  const headerCharset = ct.match(/charset=([\w-]+)/i)?.[1];
  const headLatin1 = buf.subarray(0, Math.min(buf.length, 4096)).toString("latin1");
  const metaCharset =
    headLatin1.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1] ||
    headLatin1.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i)?.[1];
  const charset = (headerCharset || metaCharset || "utf-8").toLowerCase();
  let text;
  if (charset === "utf-8" || charset === "utf8") text = buf.toString("utf8");
  else if (charset === "iso-8859-1" || charset === "latin1") text = buf.toString("latin1");
  else {
    try {
      text = new TextDecoder(charset).decode(buf);
    } catch {
      text = buf.toString("utf8");
    }
  }
  return { text, status: res.status, charset, ct };
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

console.log("=== mobile.bg charset fix ===");
{
  const url =
    "https://www.mobile.bg/obiava-11788211376644748-audi-a8-4-2tdi-s8-pack-m";
  const r = await fetchHtml(url, { "Accept-Language": "bg-BG,bg;q=0.9" });
  console.log("charset", r.charset, "status", r.status);
  const params = {};
  for (const m of r.text.matchAll(
    /class="item[^"]*"[^>]*>\s*<div class="mpLabel">([\s\S]*?)<\/div>\s*<div class="mpInfo">([\s\S]*?)<\/div>/gi,
  )) {
    params[stripTags(m[1]).toLowerCase()] = stripTags(m[2]);
  }
  console.log("пробег", params["пробег [км]"] || params["пробег"]);
  console.log("дата", params["дата на производство"]);
  const price = stripTags(r.text.match(/class="Price"[^>]*>([\s\S]{0,200})/i)?.[1] || "");
  console.log("price", price.slice(0, 80));
  console.log("has Cyrillic пробег label?", Object.keys(params).some((k) => /пробег/.test(k)));
}

console.log("\n=== standvirtual year/mileage ===");
{
  const list = await fetchHtml(
    "https://www.standvirtual.com/carros?search%5Border%5D=created_at_first%3Adesc&page=1",
    { "Accept-Language": "pt-PT,pt;q=0.9", Cookie: "language=en; lang=en" },
  );
  const url = [...list.text.matchAll(/href="(https:\/\/(?:www\.)?standvirtual\.com\/carros\/anuncio\/[^"?]+)"/g)].map(
    (m) => m[1].split("?")[0],
  )[0];
  const d = await fetchHtml(url, { "Accept-Language": "pt-PT,pt;q=0.9", Cookie: "language=en; lang=en" });
  const next = JSON.parse(d.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const advert = next.props.pageProps.advert;
  const year = advert.parametersDict?.first_registration_year?.values?.[0]?.value;
  const mileage = advert.parametersDict?.mileage?.values?.[0]?.value;
  const vin = advert.parametersDict?.vin?.values?.[0]?.value;
  console.log({ year, mileage, price: advert.price, vinEncrypted: /[+\/=]/.test(vin || ""), photos: advert.images?.photos?.length });
}

console.log("\n=== AS24 BE priceRaw ===");
{
  const list = await fetchHtml("https://www.autoscout24.be/fr/lst?atype=C&cy=B&sort=age&desc=1&ustate=N%2CU&page=1");
  const next = JSON.parse(list.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const path = next.props.pageProps.listings[0].url;
  const d = await fetchHtml(`https://www.autoscout24.be${path}`);
  const dn = JSON.parse(d.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const details = dn.props.pageProps.listingDetails;
  console.log({
    priceRaw: details.prices?.public?.priceRaw,
    price: details.prices?.public?.price,
    km: details.vehicle?.mileageInKm ?? details.vehicle?.mileage,
    year: details.vehicle?.firstRegistrationDate,
    photos: details.images?.length,
  });
}
