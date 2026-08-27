const listHtml = await (await fetch("https://www.kcar.com/bc/stockCar/list", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
})).text();

const nuxt = listHtml.match(/window\.__NUXT__=\(function\(([\s\S]*?)\)\(\);/);
console.log("nuxt block found", Boolean(nuxt));

const apiPaths = [...new Set([...listHtml.matchAll(/["'](\/api\/[^"']+)["']/g)].map((m) => m[1]))];
console.log("api paths in html", apiPaths.slice(0, 40));

for (const path of [
  "/api/bc/stockCar/list?page=1&size=20",
  "/api/bc/search/list?page=1&size=20",
  "/api/v1/bc/stockCar/list?page=1&size=20",
  "/api/public/bc/stockCar/list?page=1&size=20",
  "/bc/stockCar/list.json?page=1",
]) {
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
    console.log(path, r.status, t.slice(0, 400));
  } catch (e) {
    console.log(path, e.message);
  }
}

// fetch a nuxt chunk that might contain api base
const chunks = [...listHtml.matchAll(/\/_nuxt\/[^"']+\.js/g)].slice(0, 5).map((m) => m[0]);
for (const chunk of chunks) {
  const url = `https://www.kcar.com${chunk}`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Chrome/122" } });
  const t = await r.text();
  const hits = [...new Set([...t.matchAll(/["'](\/api\/[^"']+)["']/g)].map((m) => m[1]))];
  if (hits.length) console.log("chunk", chunk, hits.slice(0, 20));
}
