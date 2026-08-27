import fs from "fs";
const html = fs.readFileSync(new URL("../../_probe/kcar_stock_list.html", import.meta.url), "utf8");
const nuxt = html.match(/window\.__NUXT__=\(([\s\S]*?)\);<\/script>/);
console.log("nuxt script", Boolean(nuxt));
const ids = [...new Set([...html.matchAll(/K20\d{10,}/g)].map((m) => m[0]))].slice(0, 10);
console.log("K codes", ids);
const carLinks = [...new Set([...html.matchAll(/\/bc\/stockCar\/detail[^"'\\s]*/g)].map((m) => m[0]))].slice(0, 10);
console.log("detail links", carLinks);
const seqs = [...new Set([...html.matchAll(/seq=([A-Z0-9]+)/g)].map((m) => m[1]))].slice(0, 10);
console.log("seq", seqs);

// charancha chunk
const chunk = await (await fetch("https://www.charancha.com/_next/static/chunks/5683-356b2ca820ddbcef.js", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
})).text();
const urls = [...new Set([...chunk.matchAll(/https?:\/\/[^"'\\s]+/g)].map((m) => m[0]).filter((u) => /charancha|api/i.test(u)))];
console.log("\ncharancha chunk urls", urls.slice(0, 30));
const paths = [...new Set([...chunk.matchAll(/["'](\/v1[^"']+|\/api[^"']+)["']/g)].map((m) => m[1]))];
console.log("charancha paths", paths.slice(0, 30));

for (const url of [
  "https://www.charancha.com/api/v1/cars?page=1&size=20",
  "https://api.charancha.com/v1/cars?page=1&size=20",
  "https://www.charancha.com/api/cars/search?page=1",
]) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Chrome/122", Accept: "application/json" } });
    console.log(url, r.status, (await r.text()).slice(0, 300));
  } catch (e) {
    console.log(url, e.message);
  }
}
