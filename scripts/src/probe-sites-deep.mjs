import fs from "fs";
import path from "path";

const outDir = path.resolve(import.meta.dirname, "../../_probe");
fs.mkdirSync(outDir, { recursive: true });

async function save(name, url, opts = {}) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 Chrome/122",
      "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
      ...(opts.headers ?? {}),
    },
    redirect: "follow",
    ...opts,
  });
  const text = await r.text();
  fs.writeFileSync(path.join(outDir, `${name}.html`), text);
  fs.writeFileSync(path.join(outDir, `${name}.hdr`), `HTTP ${r.status}\nURL ${url}\n`);
  console.log(name, r.status, text.length);
  return text;
}

const kcarList = await save("kcar_stock_list", "https://www.kcar.com/bc/stockCar/list");
const kcarDetailMatch = kcarList.match(/\/bc\/stockCar\/detail[^"'\\s]*/)?.[0]
  || kcarList.match(/stockCar\/detail\?[^"'\\s]+/)?.[0];
console.log("kcar detail sample:", kcarDetailMatch);
if (kcarDetailMatch) {
  const detailUrl = kcarDetailMatch.startsWith("http") ? kcarDetailMatch : `https://www.kcar.com/${kcarDetailMatch.replace(/^\//, "")}`;
  await save("kcar_stock_detail", detailUrl);
}

await save("bobaedream_cyber", "https://www.bobaedream.co.kr/cyber/CyberCar.php?gubun=K");
const bob = fs.readFileSync(path.join(outDir, "bobaedream_cyber.html"), "utf8");
const bobDetail = bob.match(/CyberCar_detail\.php\?[^"'\\s]+/)?.[0];
console.log("bob detail sample:", bobDetail);
if (bobDetail) {
  await save("bobaedream_detail", `https://www.bobaedream.co.kr/cyber/${bobDetail}`);
}

await save("charancha_list", "https://www.charancha.com/bu/search/list?page=1");
await save("charancha_cars", "https://www.charancha.com/cars");

const auto = await save("autoclick_home", "https://www.autoclick.co.kr/");
const autoList = auto.match(/\/(?:cars|vehicle|stock)[^"'\\s]*/gi)?.slice(0, 10);
console.log("autoclick paths:", autoList);

await save("sellcar_js", "https://www.sellcarintl.com/assets/index.js").catch(() => null);
const sellcarRoot = fs.readFileSync(path.join(outDir, "sellcar_js.html"), "utf8").slice(0, 500);
console.log("sellcar js head:", sellcarRoot);

// try sellcar API guesses
for (const u of [
  "https://www.sellcarintl.com/api/v1/products?page=1&size=20",
  "https://www.sellcarintl.com/api/products?page=1",
  "https://api.sellcarintl.com/products?page=1",
]) {
  try {
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 Chrome/122" } });
    const t = await r.text();
    console.log("sellcar api", u, r.status, t.slice(0, 200));
  } catch (e) {
    console.log("sellcar api", u, e.message);
  }
}
