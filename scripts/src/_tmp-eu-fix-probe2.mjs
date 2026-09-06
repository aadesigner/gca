const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function get(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "it-IT,it;q=0.9", Accept: "text/html" },
    signal: AbortSignal.timeout(25000),
  });
  return { status: res.status, url: res.url, text: await res.text() };
}

const usate = await get("https://www.automobile.it/usate");
console.log("/usate", usate.status, usate.url, "next", /__NEXT_DATA__/.test(usate.text), "bot", /captcha|cloudflare|Attention Required/i.test(usate.text));
const m = usate.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
if (m) {
  const next = JSON.parse(m[1]);
  const pp = next.props?.pageProps || {};
  console.log("pageProps keys", Object.keys(pp));
  const result = pp.result || pp.apiResults?.result || pp.apiResults;
  console.log("result keys", result && typeof result === "object" ? Object.keys(result) : result);
  console.log("resultList len", result?.resultList?.length);
  if (result?.resultList?.[0]) console.log("first", JSON.stringify(result.resultList[0]).slice(0, 250));
}

const sub = await get("https://www.subito.it/annunci-italia/vendita/auto/?o=1");
const sm = sub.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
const items = JSON.parse(sm[1]).props.pageProps.initialState.items;
const kinds = {};
for (const row of items.originalList || []) kinds[row.kind || row.type || "?"] = (kinds[row.kind || row.type || "?"] || 0) + 1;
console.log("\nsubito kinds", kinds, "originalList", items.originalList?.length);

// AS24 BE price
const be = await get("https://www.autoscout24.be/fr/lst?sort=age&desc=1&atype=C&ustate=N%2CU");
console.log("\nAS24 BE", be.status, "len", be.text.length, "bot", /captcha|datadome|Attention Required/i.test(be.text));
const beLinks = [...be.text.matchAll(/href="(\/fr\/offres\/[^"]+)"/g)].map((x) => x[1]).slice(0, 3);
console.log("be links", beLinks);
if (beLinks[0]) {
  const d = await get(`https://www.autoscout24.be${beLinks[0]}`);
  console.log("detail", d.status);
  const nm = d.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nm) {
    const listing = JSON.parse(nm[1]).props?.pageProps?.listing;
    console.log("price", listing?.prices, listing?.price);
  }
}
