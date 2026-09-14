const r = await fetch("https://www.carpoolkr.com/cars", {
  headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
  signal: AbortSignal.timeout(20000),
});
const t = await r.text();
const hrefs = [...new Set([...t.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]))]
  .filter((h) => /car|vehicle|stock|inventory|list|detail|vin/i.test(h))
  .slice(0, 40);
console.log("status", r.status, "final", r.url);
console.log(hrefs);
const next = t.match(/__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/);
if (next) {
  const j = JSON.parse(next[1]);
  console.log("next keys", Object.keys(j?.props?.pageProps ?? j));
  console.log(JSON.stringify(j?.props?.pageProps ?? {}, null, 2).slice(0, 1500));
}
