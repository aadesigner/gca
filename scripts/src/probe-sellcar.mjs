const r = await fetch("https://www.sellcarintl.com/buy-now", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
});
const t = await r.text();
const scripts = [...t.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
console.log("scripts", scripts);
for (const s of scripts) {
  const url = s.startsWith("http") ? s : `https://www.sellcarintl.com${s}`;
  const jr = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Chrome/122" } });
  const jt = await jr.text();
  const apis = [...new Set([...jt.matchAll(/["'](\/api\/v1[^"']+)["']/g)].map((m) => m[1]))];
  if (apis.length) console.log("apis from", url.split("/").pop(), apis.slice(0, 30));
}

for (const path of [
  "/api/v1/buy-now/list?page=1&size=20",
  "/api/v1/buy-now/products?page=1&size=20",
  "/api/v1/product/list?page=1&size=20",
  "/api/v1/vehicle/list?page=1&size=20",
  "/api/v1/stock/list?page=1&size=20",
]) {
  const url = `https://www.sellcarintl.com${path}`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 Chrome/122", Accept: "application/json" },
    });
    const body = await resp.text();
    console.log(path, resp.status, body.slice(0, 300));
  } catch (e) {
    console.log(path, e.message);
  }
}
