const id = process.argv[2] || "IC5494339";
const headers = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
  Accept: "application/json",
  Origin: "https://m.autowini.com",
  Referer: "https://m.autowini.com/",
  "wini-code-select-country": "C1570",
};
const token = process.env.AUTWINI_TOKEN;
if (token) headers.Authorization = `Bearer ${token}`;

const searchRes = await fetch(
  `https://v2api.autowini.com/items/cars?condition=C020&keyword=${id}&pageSize=5`,
  { headers },
);
const searchJson = await searchRes.json();
const item = searchJson.data?.items?.[0];
console.log("=== search item photo-related keys ===");
for (const [k, v] of Object.entries(item || {})) {
  if (/photo|image|thumb|gallery|picture|url/i.test(k) || (Array.isArray(v) && v.some((x) => typeof x === "string" && x.includes("http")))) {
    console.log(k, typeof v === "object" ? JSON.stringify(v).slice(0, 800) : v);
  }
}

const detailRes = await fetch(`https://v2api.autowini.com/items/${id}`, { headers });
const detailJson = await detailRes.json();
console.log("\n=== detail ALL keys ===");
console.log(Object.keys(detailJson.data || {}));
console.log("\n=== detail photo-related ===");
for (const [k, v] of Object.entries(detailJson.data || {})) {
  if (/photo|image|thumb|gallery|picture|url/i.test(k) || (Array.isArray(v) && v.some((x) => typeof x === "string" && x.includes("http")))) {
    console.log(k, typeof v === "object" ? JSON.stringify(v).slice(0, 800) : v);
  }
}

// try photos endpoint with token
if (token) {
  for (const path of [`/items/${id}/photos`, `/items/${id}/gallery`]) {
    const r = await fetch(`https://v2api.autowini.com${path}`, { headers });
    console.log("\n", path, r.status, (await r.text()).slice(0, 500));
  }
}

// derive folder from thumbs and list sibling files via common uuid pattern?
const urls = [
  item?.mainThumbnailPath,
  item?.subThumbnail1Path,
  item?.subThumbnail2Path,
  ...(item?.thumbnails || []),
].filter(Boolean);
console.log("\n=== all search photo urls ===", urls.length);
for (const u of urls) console.log(u);

const dirs = [...new Set(urls.map((u) => u.replace(/[^/]+$/, "")))];
console.log("\n=== unique dirs ===", dirs);
