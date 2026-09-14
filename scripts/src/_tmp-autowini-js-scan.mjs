import fs from "node:fs";

const urls = [
  "https://image.autowini.com/SCRIPT/mobile/js/cm_function.js",
  "https://image.autowini.com/SCRIPT/mobile/js/security/auth/auth_security_min.js",
];
for (const url of urls) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const t = await r.text();
  const hits = [...t.matchAll(/["'`]\/items\/[^"'`]{3,80}["'`]/g)].map((m) => m[0]);
  const photoHits = [...t.matchAll(/photo[a-zA-Z]{0,20}/g)].map((m) => m[0]);
  console.log("\n===", url.split("/").pop(), "len", t.length);
  console.log("item paths", [...new Set(hits)].slice(0, 30));
  console.log("photo tokens", [...new Set(photoHits)].filter((x) => /photo/i.test(x)).slice(0, 30));
  const photosEndpoint = t.match(/items\/[^"'`]*photo[^"'`]*/gi);
  console.log("photosEndpoint", [...new Set(photosEndpoint ?? [])].slice(0, 20));
}
