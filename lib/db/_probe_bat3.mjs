import { writeFileSync } from "fs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const r = await fetch("https://bringatrailer.com/auctions/results/", {
  headers: { "User-Agent": UA },
});
const t = await r.text();
writeFileSync("_bat_results.html", t);

// All script src
const scripts = [...t.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
console.log("all scripts", scripts.length);
for (const s of scripts) {
  if (/bat|auction|theme|listing|knock|results|main|app|bundle/i.test(s)) console.log("  ", s);
}

// Find bat_auctions_results localization
const idx = t.indexOf("bat_auctions_results");
console.log("idx", idx);
if (idx >= 0) console.log(t.slice(Math.max(0, idx - 200), idx + 800));

// Look for wp_localize / var BaT
for (const name of ["BaT_Theme", "batAuctions", "auctionsResults", "listingsData", "initialItems"]) {
  const i = t.indexOf(name);
  if (i >= 0) console.log("\n===", name, "===\n", t.slice(i, i + 500));
}
