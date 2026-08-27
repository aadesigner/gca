const jr = await fetch("https://www.sellcarintl.com/assets/index-BY7pngw6.js", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
});
const jt = await jr.text();
const apis = [...new Set([...jt.matchAll(/["'](\/api\/v1[^"']+)["']/g)].map((m) => m[1]))];
console.log("sellcar apis", apis);

for (const path of apis.slice(0, 25)) {
  const url = `https://www.sellcarintl.com${path}`;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 Chrome/122", Accept: "application/json" },
    });
    const t = await r.text();
    console.log(path, r.status, t.slice(0, 250));
  } catch (e) {
    console.log(path, e.message);
  }
}

const kcarPaths = [
  "/api/v1/cc/search/?page=1&size=20",
  "/api/v1/cc/search?page=1&size=20",
  "/api/v1/cc/search/list?page=1&size=20",
  "/api/v1/cc/search/stockCar?page=1&size=20",
  "/api/v1/cc/search/stockCarList?page=1&size=20",
];
for (const path of kcarPaths) {
  const url = `https://www.kcar.com${path}`;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 Chrome/122",
        Accept: "application/json",
        Referer: "https://www.kcar.com/bc/stockCar/list",
      },
    });
    const t = await r.text();
    console.log("kcar", path, r.status, t.slice(0, 500));
  } catch (e) {
    console.log("kcar", path, e.message);
  }
}

const char = await fetch("https://www.charancha.com/cars?page=1", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
});
const ct = await char.text();
const links = [...ct.matchAll(/href=\"(\/bu\/[^\"]+)\"/g)].map((m) => m[1]).slice(0, 20);
console.log("charancha bu links", [...new Set(links)]);
const carIds = [...ct.matchAll(/sellNo[\"':=]+([A-Za-z0-9_-]+)/g)].map((m) => m[1]).slice(0, 10);
console.log("charancha sellNo", carIds);
const scripts = [...ct.matchAll(/src=\"([^\"]+\.js)\"/g)].map((m) => m[1]).slice(0, 8);
console.log("charancha scripts", scripts);
