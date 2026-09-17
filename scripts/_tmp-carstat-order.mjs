import fs from "fs";

const html = fs.readFileSync(`${process.env.TEMP}/carstat-lot.html`, "utf8");
const lds = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(
  (m) => JSON.parse(m[1]),
);
const nodes = lds.flatMap((x) => (Array.isArray(x["@graph"]) ? x["@graph"] : [x]));
const vehicle = nodes.find(
  (n) => n?.["@type"] === "Vehicle" || (Array.isArray(n?.["@type"]) && n["@type"].includes("Vehicle")),
);
const imgs = vehicle?.image;
console.log("ld count", Array.isArray(imgs) ? imgs.length : imgs ? 1 : 0);
if (Array.isArray(imgs)) imgs.slice(0, 6).forEach((u, i) => console.log("ld", i, String(u).slice(-55)));

const galleryHtml = html.match(/aria-label=["']Photographs["'][\s\S]*?<\/section>/i)?.[0] || "";
const galleryOrder = [];
const seenG = new Set();
for (const m of galleryHtml.matchAll(/https:\/\/carstat\.info\/api\/lot-image\/[a-f0-9-]+\/(?!thumbnail)[A-HJ-NPR-Z0-9]{17}/gi)) {
  if (seenG.has(m[0])) continue;
  seenG.add(m[0]);
  galleryOrder.push(m[0]);
}
console.log("gallery section unique", galleryOrder.length);
galleryOrder.slice(0, 6).forEach((u, i) => console.log("gal", i, u.slice(-55)));

const htmlOrder = [];
const seen = new Set();
for (const m of html.matchAll(/https:\/\/carstat\.info\/api\/lot-image\/[a-f0-9-]+\/(?!thumbnail)[A-HJ-NPR-Z0-9]{17}/gi)) {
  if (seen.has(m[0])) continue;
  seen.add(m[0]);
  htmlOrder.push(m[0]);
}
console.log("full html unique", htmlOrder.length);

if (Array.isArray(imgs) && galleryOrder.length) {
  console.log("ld==gallery", imgs.length === galleryOrder.length && imgs.every((u, i) => u === galleryOrder[i]));
  for (let i = 0; i < Math.min(imgs.length, galleryOrder.length); i++) {
    if (imgs[i] !== galleryOrder[i]) {
      console.log("mismatch", i, { ld: String(imgs[i]).slice(-40), gal: galleryOrder[i].slice(-40) });
      break;
    }
  }
}

// Find damageZones in RSC
const dz = html.match(/damageZones":(\[[^\]]*\])/);
console.log("damageZones json", dz?.[1]);
const marked = html.match(/Marked zones[\s\S]{0,80}/i);
console.log("marked", marked?.[0]?.slice(0, 80));
