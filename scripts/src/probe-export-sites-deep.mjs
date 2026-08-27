import fs from "fs";
import path from "path";

const outDir = path.resolve(import.meta.dirname, "../../_probe");
fs.mkdirSync(outDir, { recursive: true });

async function probe(name, url) {
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 Chrome/122", "Accept-Language": "en,ko" },
  });
  const t = await r.text();
  fs.writeFileSync(path.join(outDir, `${name}.html`), t);
  console.log(name, r.status, t.length);
  const links = [...new Set([...t.matchAll(/href=["']([^"']*(?:detail|view|car|vehicle|stock|goods)[^"']*)["']/gi)].map((m) => m[1]))].slice(0, 15);
  console.log("links", links.join("\n  "));
  const ids = [...new Set([...t.matchAll(/(?:no=|id=|seq=|goodsNo=|carId=|sellNo=)(\d+)/gi)].map((m) => m[0]))].slice(0, 10);
  console.log("ids", ids);
  return t;
}

await probe("koreaautotrade_list", "https://www.koreaautotrade.com/eng/car/list.php");
await probe("heydealer_home", "https://www.heydealer.com/");
await probe("usedcarkorea_home", "https://www.usedcarkorea.com/");

// heydealer market paths
for (const p of ["/market", "/cars", "/used-cars", "/buy", "/search"]) {
  try {
    const r = await fetch(`https://www.heydealer.com${p}`, { headers: { "User-Agent": "Mozilla/5.0 Chrome/122" } });
    console.log("heydealer path", p, r.status, (await r.text()).length);
  } catch (e) {
    console.log("heydealer path", p, e.message);
  }
}

// koreaautotrade detail from list html
const list = fs.readFileSync(path.join(outDir, "koreaautotrade_list.html"), "utf8");
const detail = list.match(/href=["']([^"']*view[^"']*)["']/i)?.[1]
  || list.match(/href=["']([^"']*detail[^"']*)["']/i)?.[1];
console.log("koreaautotrade detail link", detail);
if (detail) {
  const url = detail.startsWith("http") ? detail : `https://www.koreaautotrade.com/eng/car/${detail.replace(/^\.\//, "")}`;
  await probe("koreaautotrade_detail", url.replace("/eng/car/../", "/").replace("/eng/car/./", "/eng/car/"));
}

// usedcarkorea list
const uck = fs.readFileSync(path.join(outDir, "usedcarkorea_home.html"), "utf8");
const uckLinks = [...new Set([...uck.matchAll(/href=["']([^"']+)["']/g)].map((m) => m[1]))].filter((h) => /car|vehicle|inventory|stock|detail|view/i.test(h)).slice(0, 20);
console.log("usedcarkorea links", uckLinks);
