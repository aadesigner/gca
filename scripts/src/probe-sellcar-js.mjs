const js = await (await fetch("https://www.sellcarintl.com/assets/index-BY7pngw6.js", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
})).text();
console.log("js len", js.length);
const patterns = ["buy-now", "buyNow", "product", "vehicle", "stock", "/api/v1/"];
for (const p of patterns) {
  const idx = js.indexOf(p);
  if (idx >= 0) console.log(p, js.slice(Math.max(0, idx - 40), idx + 120).replace(/\s+/g, " "));
}
const apis = [...new Set([...js.matchAll(/\/api\/v1\/[a-zA-Z0-9_/-]+/g)].map((m) => m[0]))];
console.log("apis", apis);

for (const path of apis.slice(0, 20)) {
  const url = `https://www.sellcarintl.com${path}`;
  const r = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 Chrome/122" },
  });
  const t = await r.text();
  if (r.status === 200 && t.startsWith("{")) console.log("OK", path, t.slice(0, 300));
}
