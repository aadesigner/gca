const id = process.argv[2] || "IC5494339";

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
  Accept: "application/json, text/html",
  Origin: "https://m.autowini.com",
  Referer: "https://m.autowini.com/",
  "wini-code-select-country": "C1570",
};

const searchRes = await fetch(
  `https://v2api.autowini.com/items/cars?condition=C020&keyword=${id}&pageSize=5`,
  { headers },
);
const searchJson = await searchRes.json();
const item = searchJson.data?.items?.[0];
console.log("search photoCount", item?.photoCount);
console.log("thumbnails", item?.thumbnails?.length);
console.log("sample thumb", item?.mainThumbnailPath);

// imagebox URL pattern from thumb
const thumb = item?.mainThumbnailPath || item?.thumbnails?.[0];
if (thumb) {
  console.log("thumb url", thumb);
}

// probe imagebox numbered frames if we can derive IC path
async function head(url) {
  try {
    const r = await fetch(url, { method: "HEAD", headers: { Referer: "https://www.autowini.com/" } });
    return r.status;
  } catch (e) {
    return String(e.message);
  }
}

// common autowini imagebox patterns
const probes = [];
for (let i = 0; i < 25; i++) {
  probes.push(`https://imagebox.autowini.com/data/item/${id}/${i}_720.jpeg`);
  probes.push(`https://imagebox.autowini.com/data/item/${id}/${i}_320.jpeg`);
  probes.push(`https://imagebox.autowini.com/data/item/${id.toLowerCase()}/${i}_720.jpeg`);
}
let hits720 = 0;
for (let i = 0; i < 25; i++) {
  const u = `https://imagebox.autowini.com/data/item/${id}/${i}_720.jpeg`;
  const st = await head(u);
  if (st === 200) {
    hits720++;
    if (hits720 <= 3) console.log("hit", u);
  } else if (i === 0) console.log("first probe status", st, u);
}

// parse thumb path for pattern
if (thumb) {
  const m = thumb.match(/^(https?:\/\/[^/]+)(\/.*\/)([^/]+)_(\d+)\.(jpeg|jpg|webp)/i);
  console.log("thumb parse", m?.slice(1));
  if (m) {
    const [, host, dir, uuid, size, ext] = m;
    for (let i = 0; i < 25; i++) {
      const u = `${host}${dir}${uuid}_${720}.${ext}`;
      if (i > 0) break; // same uuid won't work for index
    }
    // try directory listing style - replace uuid with index?
    const dirMatch = thumb.match(/^(.*\/)[^/]+_\d+\.(jpeg|jpg|webp)/i);
    if (dirMatch) {
      console.log("dir prefix", dirMatch[1].slice(-80));
    }
  }
}

// fetch mobile detail page
const detailUrl = item?.detailUrl?.startsWith("http")
  ? item.detailUrl
  : `https://www.autowini.com/items/Used-car-${id}`;
const htmlRes = await fetch(detailUrl, { headers: { ...headers, Accept: "text/html" } });
const html = await htmlRes.text();
console.log("html status", htmlRes.status, "len", html.length);

const imagebox = [...html.matchAll(/https?:\/\/imagebox\.autowini\.com[^"'\\\s<>]+/gi)].map((m) => m[0]);
console.log("imagebox urls in html", new Set(imagebox).size);
console.log("samples", [...new Set(imagebox)].slice(0, 8));

const photoJson = html.match(/"photos"\s*:\s*\[[^\]]+\]/);
console.log("photos json snippet", photoJson?.[0]?.slice(0, 300));

// m.autowini detail API?
for (const path of [`/items/${id}/gallery`, `/items/${id}/photo`, `/item/${id}/photos`]) {
  const r = await fetch(`https://v2api.autowini.com${path}`, { headers });
  console.log(path, r.status, (await r.text()).slice(0, 120));
}
