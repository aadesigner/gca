import { writeFileSync } from "fs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const page = await fetch("https://bringatrailer.com/auctions/results/", {
  headers: { "User-Agent": UA },
});
const html = await page.text();

const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]);
for (const s of scripts) console.log(s);

const candidates = scripts.filter((s) => /bat|theme|site|auction/i.test(s) || /wp-content\/themes/i.test(s));
for (const url of candidates) {
  const abs = url.startsWith("http") ? url : `https://bringatrailer.com${url}`;
  console.log("\nFetching", abs);
  const r = await fetch(abs, { headers: { "User-Agent": UA } });
  const js = await r.text();
  console.log("status", r.status, "len", js.length);
  if (/loadNextPage|bat_auctions_results|ajaxActionAuctionsResults/.test(js)) {
    writeFileSync("_bat_site.js", js);
    const idxs = [];
    for (const re of [/loadNextPage/g, /bat_auctions_results/g, /ajaxActionAuctionsResults/g, /auctions_results/g]) {
      let m;
      while ((m = re.exec(js))) idxs.push({ re: re.source, i: m.index });
    }
    for (const { re, i } of idxs.slice(0, 15)) {
      console.log("\n---", re, "at", i, "---");
      console.log(js.slice(Math.max(0, i - 120), i + 400));
    }
  }
}
