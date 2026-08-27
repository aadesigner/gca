import { writeFileSync } from "fs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const page = await fetch("https://bringatrailer.com/auctions/results/", {
  headers: { "User-Agent": UA },
});
const html = await page.text();
const scripts = [...html.matchAll(/src=["'](https:\/\/bringatrailer\.com\/_static\/[^"']+)["']/gi)].map(
  (m) => m[1],
);

for (const url of scripts) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  const js = await r.text();
  const hit = /loadNextPage|ajaxActionAuctionsResults|bat_auctions_results/.test(js);
  console.log(r.status, js.length, hit, url.slice(0, 80));
  if (hit) {
    writeFileSync("_bat_site.js", js);
    let i = js.indexOf("loadNextPage");
    while (i >= 0 && i < js.length) {
      console.log("\n=== at", i, "===\n", js.slice(i - 100, i + 500));
      i = js.indexOf("loadNextPage", i + 1);
      if (i > 200000) break;
    }
    i = js.indexOf("ajaxActionAuctionsResults");
    if (i >= 0) console.log("\n=== ajaxAction ===\n", js.slice(i - 80, i + 600));
    i = js.indexOf("auctions_results");
    if (i >= 0) console.log("\n=== auctions_results ===\n", js.slice(i - 80, i + 600));
  }
}
