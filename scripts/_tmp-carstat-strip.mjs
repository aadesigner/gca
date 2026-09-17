import fs from "fs";
const h = fs.readFileSync(`${process.env.TEMP}/carstat-lot.html`, "utf8");
const idx = h.indexOf('aria-label="Photographs"');
console.log("idx", idx);
const slice = idx >= 0 ? h.slice(idx, idx + 15000) : "";
console.log(slice.slice(0, 1500));
const imgs = [...slice.matchAll(/lot-image\/([a-f0-9-]+)/gi)].map((m) => m[1]);
const uniq = [];
const seen = new Set();
for (const id of imgs) {
  if (seen.has(id)) continue;
  seen.add(id);
  uniq.push(id);
}
console.log("strip order", uniq.length, uniq.slice(0, 8));
const ld = JSON.parse(
  h.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i)?.[1] || "{}",
);
const vehicle = (ld["@graph"] || []).find((n) => n["@type"] === "Vehicle");
const ldIds = (Array.isArray(vehicle?.image) ? vehicle.image : []).map((u) =>
  String(u).match(/lot-image\/([a-f0-9-]+)/i)?.[1],
);
console.log("ld order", ldIds.slice(0, 8));
console.log("same", uniq.length && uniq.every((id, i) => id === ldIds[i]));
