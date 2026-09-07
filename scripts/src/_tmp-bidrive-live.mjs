import fs from "node:fs";

const url =
  "https://thebidrive.com/en/listing/166451a2-91d2-4942-a038-21da5c9ee3cc/2018-audi-a6-wauzzz4g4jn063256";
const html = await (
  await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept-language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(30000),
  })
).text();
fs.writeFileSync("scripts/src/_tmp-bidrive-detail.html", html);

const ldBlocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(
  (m) => m[1],
);
console.log("ld blocks", ldBlocks.length);
for (const b of ldBlocks) {
  try {
    const j = JSON.parse(b);
    const nodes = Array.isArray(j) ? j : [j, ...(j["@graph"] || [])];
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      if (n.image || n.vehicleIdentificationNumber || /Car|Vehicle|Product/i.test(String(n["@type"] || ""))) {
        const imgs = Array.isArray(n.image) ? n.image : n.image ? [n.image] : [];
        console.log("LD type", n["@type"], "name", String(n.name || "").slice(0, 60), "vin", n.vehicleIdentificationNumber, "images", imgs.length);
        const urls = imgs.map((i) => (typeof i === "string" ? i : i?.url || i?.contentUrl)).filter(Boolean);
        console.log(" first3", urls.slice(0, 3));
        console.log(" last3", urls.slice(-3));
        const hosts = {};
        for (const u of urls) {
          try {
            const h = new URL(u).hostname;
            hosts[h] = (hosts[h] || 0) + 1;
          } catch {}
        }
        console.log(" hosts", hosts);
      }
    }
  } catch (e) {
    console.log("ld parse err", e.message);
  }
}

const cdn = [...html.matchAll(/https:\/\/cdn\.thebidrive\.com\/[^"'\\\s>]+\.(?:webp|jpg|jpeg|png|avif)/gi)].map((m) =>
  m[0].split("?")[0],
);
const byCat = {};
for (const u of [...new Set(cdn)]) {
  const m = u.match(/catalog\/(IC\d+)\//i) || u.match(/\/([a-f0-9-]{8,})\//i);
  const k = m?.[1] || u.replace("https://cdn.thebidrive.com/", "").split("/").slice(0, 3).join("/");
  byCat[k] = (byCat[k] || 0) + 1;
}
console.log("unique cdn", new Set(cdn).size, "groups", byCat);

// Find next-data or __NEXT_DATA__
const next = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
if (next) {
  const j = JSON.parse(next[1]);
  const s = JSON.stringify(j);
  console.log("NEXT_DATA keys", Object.keys(j.props?.pageProps || {}));
  const imgHits = [...s.matchAll(/"(https:\\\/\\\/cdn\.thebidrive\.com[^"]+)"/g)].slice(0, 5);
  console.log("next img samples", imgHits.map((m) => m[1].replace(/\\\//g, "/").slice(0, 100)));
}

for (const needle of ["Similar", "Related", "Recommended", "More vehicles", "You may also", "similarListings", "relatedListings"]) {
  if (html.includes(needle)) console.log("found marker", needle);
}
