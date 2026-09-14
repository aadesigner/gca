const url =
  "https://thebidrive.com/en/listing/66f56487-99dd-40a3-a7d9-4de623eeab76/2019-kg-mobility-ssangyong-tivoli-kpbxa3at1lp320822";
const html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
const idx = html.indexOf("42420420");
console.log("hits", idx);
if (idx >= 0) console.log(html.slice(idx - 100, idx + 400));
const encarCdn = [...html.matchAll(/cdn\.thebidrive\.com\/encar\/42420420\/[^"'\\\s>]+/gi)].map((m) => m[0]);
console.log("cdn for 42420420", encarCdn);
