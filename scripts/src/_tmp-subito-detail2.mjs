const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const url = "https://www.subito.it/auto/renault-kangoo-messina-659735227.htm";
const res = await fetch(url, {
  headers: {
    "User-Agent": UA,
    "Accept-Language": "it-IT,it;q=0.9",
    Accept: "text/html,application/xhtml+xml",
  },
  signal: AbortSignal.timeout(25000),
});
const html = await res.text();
console.log("status", res.status, "len", html.length, "final", res.url);
console.log("has NEXT_DATA", /__NEXT_DATA__/.test(html));
console.log("title", html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.slice(0, 120));
console.log("slice", html.slice(0, 400).replace(/\s+/g, " "));
const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
if (m) {
  const next = JSON.parse(m[1]);
  console.log("top keys", Object.keys(next));
  console.log("props keys", next.props && Object.keys(next.props));
  console.log("pageProps", next.props?.pageProps && Object.keys(next.props.pageProps));
  // dump JSON paths containing subject/features
  const s = m[1];
  console.log("subject idx", s.indexOf('"subject"'));
  console.log("features idx", s.indexOf('"features"'));
  console.log("mileage", s.match(/mileage_scalar[\s\S]{0,120}/)?.[0]);
}
// list page item for metadata-only parse
const list = await fetch("https://www.subito.it/annunci-italia/vendita/auto/?o=1", {
  headers: { "User-Agent": UA, "Accept-Language": "it-IT,it;q=0.9" },
  signal: AbortSignal.timeout(25000),
});
const lhtml = await list.text();
const lm = lhtml.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
const items = lm ? JSON.parse(lm[1]).props?.pageProps?.initialState?.items?.originalList : [];
const first = items?.find((x) => x?.kind === "AdItem" || x?.urls?.default);
console.log("\nlist item keys", first && Object.keys(first));
console.log("features keys", first?.features && Object.keys(first.features).slice(0, 15));
if (first?.features) {
  for (const [k, v] of Object.entries(first.features).slice(0, 10)) {
    console.log(k, JSON.stringify(v).slice(0, 120));
  }
}
console.log("images", first?.images?.length, first?.images?.[0]);
