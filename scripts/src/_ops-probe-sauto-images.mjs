const h = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0",
  Referer: "https://www.sauto.cz/",
};
const s = await fetch("https://www.sauto.cz/api/v1/items/search?limit=1&offset=0", { headers: h });
const j = await s.json();
const row = j.results[0];
const id = row.id;
const make = row.manufacturer_cb?.seo_name;
const model = row.model_cb?.seo_name;
const detailUrl = `https://www.sauto.cz/osobni/detail/${make}/${model}/${id}`;
console.log("detailUrl", detailUrl);

const page = await fetch(detailUrl, {
  headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
});
const html = await page.text();
console.log("page", page.status, "len", html.length);

const imgs = [...html.matchAll(/https?:\/\/[^"'\\\s>]*sdn\.cz[^"'\\\s>]*/gi)].map((m) => m[0]);
console.log("page imgs", [...new Set(imgs)].slice(0, 10));
const rel = [...html.matchAll(/\/\/d\d+-a\.sdn\.cz[^"'\\\s>]*/gi)].map((m) => "https:" + m[0]);
console.log("rel", [...new Set(rel)].slice(0, 10));

const apiUrl = "https:" + row.images[0].url;
console.log("apiUrl", apiUrl);

const candidates = [
  apiUrl,
  apiUrl.replace(/\.jpeg$/i, ".jpg"),
  `${apiUrl}?fl=res,800,600,3|shr,,50|webp,90`,
  apiUrl.replace("/d_19/", "/d_19/c_img_"),
];

for (const u of candidates) {
  const r = await fetch(u, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: detailUrl,
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  const b = Buffer.from(await r.arrayBuffer());
  console.log(r.status, b.length, b.slice(0, 4).toString("hex"), u.slice(0, 120));
}

// Look for img CDN patterns / signed URLs in embedded JSON
const m = html.match(/"url"\s*:\s*"(\/\/[^"]+sdn\.cz[^"]+)"/);
console.log("embedded url", m?.[1]);
const m2 = html.match(/sdn\.cz[^"']{10,120}/);
console.log("any sdn snippet", m2?.[0]);
