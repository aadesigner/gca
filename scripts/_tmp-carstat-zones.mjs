import fs from "fs";

const h = fs.readFileSync(`${process.env.TEMP}/carstat-lot.html`, "utf8");
const i = h.toLowerCase().indexOf("total loss");
const slice = h.slice(Math.max(0, i - 500), i + 12000);
const classes = [...slice.matchAll(/class="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((c) => /zone|damage|stamp|mark|panel|hit|active|on\b/i.test(c));
console.log("classes", [...new Set(classes)].slice(0, 50));

// Look for data attributes
const data = [...slice.matchAll(/data-[a-z-]+="[^"]{0,40}"/gi)].map((m) => m[0]);
console.log("data", [...new Set(data)].slice(0, 30));

// aria-pressed / aria-selected on zone buttons
const buttons = [...slice.matchAll(/<button[^>]*>[\s\S]{0,80}?<\/button>/gi)].slice(0, 30);
for (const b of buttons) {
  const t = b[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (/front|rear|left|right|roof|engine|frame|under/i.test(t)) console.log("btn", t.slice(0, 80), b[0].slice(0, 120));
}

// RSC push for zones
const rsc = [...h.matchAll(/damageZones["']?\s*[:=]\s*(\[[^\]]*\])/gi)].map((m) => m[1]);
console.log("rsc zones", rsc.slice(0, 5));
const zones2 = [...h.matchAll(/"zones"\s*:\s*(\[[^\]]*\])/gi)].map((m) => m[1]);
console.log("zones key", zones2.slice(0, 5));
