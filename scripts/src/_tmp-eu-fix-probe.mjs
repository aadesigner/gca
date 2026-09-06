const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function get(url, lang) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/json",
      "Accept-Language": lang,
    },
    signal: AbortSignal.timeout(25000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, url: res.url, buf, text: buf.toString("utf8") };
}

// mobile.bg encoding
const bg = await get("https://www.mobile.bg/obiavi/avtomobili-dzhipove", "bg-BG,bg;q=0.9");
const idPath = bg.text.match(/\/obiava-(\d+)-[^"'\\\s<>]+/)?.[0];
const d = await get(`https://www.mobile.bg${idPath}`, "bg-BG,bg;q=0.9");
console.log("mobile content-type check charset hints", d.text.match(/charset=[\w-]+/i)?.[0]);
for (const enc of ["utf8", "latin1", "ascii"]) {
  /* already utf8 */
}
// try decode as windows-1251
const decoded = new TextDecoder("windows-1251").decode(d.buf);
const utfOk = /година|пробег|лв|Марка/i.test(d.text);
const cpOk = /година|пробег|лв|Марка/i.test(decoded);
console.log("utf has cyrillic labels", utfOk, "cp1251 has", cpOk);
if (cpOk) {
  const params = [...decoded.matchAll(/mpLabel">([^<]+)<[\s\S]*?mpInfo">([^<]+)/gi)]
    .map((m) => `${m[1].trim()}=${m[2].trim()}`)
    .slice(0, 12);
  console.log("cp1251 params", params);
  const price = decoded.match(/class="Price"[^>]*>([\s\S]{0,120})/i)?.[1]?.replace(/<[^>]+>/g, " ");
  console.log("cp1251 price", price);
}

// subito initialState
const sub = await get("https://www.subito.it/annunci-italia/vendita/auto/?o=1", "it-IT,it;q=0.9");
const m = sub.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
const next = JSON.parse(m[1]);
const is = next.props.pageProps.initialState;
console.log("\nsubito initialState keys", Object.keys(is || {}));
console.log("items keys", Object.keys(is?.items || {}));
const list = is?.items?.list || is?.items?.ads || is?.items;
console.log("list type", Array.isArray(list), Array.isArray(list) ? list.length : typeof list);
if (list && typeof list === "object" && !Array.isArray(list)) {
  console.log("list object keys sample", Object.keys(list).slice(0, 10));
  const firstKey = Object.keys(list)[0];
  console.log("first item", JSON.stringify(list[firstKey]).slice(0, 300));
}
const ads = is?.ads || is?.listing?.ads || is?.search?.items;
console.log("ads?", Array.isArray(ads) ? ads.length : typeof ads);
// dump shallow structure
function walk(obj, path = "", depth = 0) {
  if (depth > 3 || !obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    if (obj.length && obj[0] && typeof obj[0] === "object" && (obj[0].urn || obj[0].urls || obj[0].subject)) {
      console.log("FOUND ARRAY", path, "len", obj.length, "sample keys", Object.keys(obj[0]));
    }
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) && v.length > 3) walk(v, path + "." + k, depth + 1);
    else if (v && typeof v === "object") walk(v, path + "." + k, depth + 1);
  }
}
walk(is, "initialState");

// automobile.it list urls
for (const u of [
  "https://www.automobile.it/",
  "https://www.automobile.it/auto-usate",
  "https://www.automobile.it/ricerca/auto",
  "https://www.automobile.it/vendita-auto",
]) {
  const r = await get(u, "it-IT,it;q=0.9");
  console.log("\nautomobile", u, r.status, r.url, "next?", /__NEXT_DATA__/.test(r.text), "bot", /captcha|cloudflare|Attention Required/i.test(r.text));
}

// standvirtual year + vin handling
const sv = await get(
  "https://www.standvirtual.com/carros/anuncio/toyota-c-hr-ID8Q0YwI.html",
  "pt-PT,pt;q=0.9",
);
const sn = JSON.parse(sv.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]);
const advert = sn.props.pageProps.advert;
console.log("\nSV first_registration_year", advert.details?.find((d) => d.key === "first_registration_year"));
console.log("SV parametersDict keys", Object.keys(advert.parametersDict || {}).slice(0, 30));
