import fs from "fs";
import path from "path";

const outDir = path.resolve(import.meta.dirname, "../../_probe");
fs.mkdirSync(outDir, { recursive: true });

async function save(name, url) {
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 Chrome/122", "Accept-Language": "ko,en" },
  });
  const t = await r.text();
  fs.writeFileSync(path.join(outDir, `${name}.html`), t);
  console.log(name, r.status, t.length);
  return t;
}

const autobellList = await save(
  "autobell_list",
  "https://www.autobell.co.kr/buycar/searchList?detailTab=0&filterTab=0&homeSvc=N&listType=card&order=upd_dt&subTab=0&tab=1&viewType=1&page=1",
);
const autobellLinks = [...new Set([...autobellList.matchAll(/href=["']([^"']*(?:detail|view|buycar)[^"']*)["']/gi)].map((m) => m[1]))].slice(0, 20);
console.log("autobell links", autobellLinks);
const autobellIds = [...new Set([...autobellList.matchAll(/(?:carSeq|goodsNo|sellNo|car_no|carNo)[\"'=:\s]+([A-Za-z0-9_-]+)/gi)].map((m) => m[0]))].slice(0, 15);
console.log("autobell id patterns", autobellIds);

const autohubList = await save("autohub_home", "https://www.autohub.co.kr/");
const autohubLinks = [...new Set([...autohubList.matchAll(/href=["']([^"']*(?:detail|carList|buy)[^"']*)["']/gi)].map((m) => m[1]))].slice(0, 20);
console.log("autohub links", autohubLinks);

// try autohub car list
for (const url of [
  "https://www.autohub.co.kr/buy/carList.asp",
  "https://www.autohub.co.kr/buy/carList.asp?page=1",
  "https://www.autohub.co.kr/guide/carList-store.asp?shopNo=100054",
]) {
  try {
    const t = await save("autohub_try", url);
    const links = [...new Set([...t.matchAll(/detailView\.asp[^"'\\s]*/gi)].map((m) => m[0]))].slice(0, 5);
    console.log(url, "detail refs", links);
  } catch (e) {
    console.log(url, e.message);
  }
}

// bobaedream mycar detail fields already known - save list page 1
await save("bobaedream_mycar_list", "https://www.bobaedream.co.kr/mycar/mycar_list.php?gubun=K&page=1&order=S11");
await save("bobaedream_mycar_detail", "https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2264283");

// autobell detail from first link
const detailLink = autobellLinks.find((l) => /detail|view|buyCar/i.test(l));
console.log("autobell detail candidate", detailLink);
if (detailLink) {
  const url = detailLink.startsWith("http") ? detailLink : `https://www.autobell.co.kr${detailLink.startsWith("/") ? "" : "/"}${detailLink}`;
  await save("autobell_detail", url);
}
