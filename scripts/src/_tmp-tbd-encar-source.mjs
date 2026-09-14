const url =
  "https://thebidrive.com/en/listing/66f56487-99dd-40a3-a7d9-4de623eeab76/2019-kg-mobility-ssangyong-tivoli-kpbxa3at1lp320822";
const html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
for (const pat of [/sourceUrl\\":\\"[^"]+/g, /"sourceUrl":"[^"]+/g, /encar[^"\\]{0,120}/gi]) {
  const hits = [...html.matchAll(pat)].map((m) => m[0]).slice(0, 8);
  if (hits.length) console.log(pat, hits);
}
