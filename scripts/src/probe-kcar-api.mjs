const t = await (await fetch("https://www.kcar.com/_nuxt/5a3aaf5.js", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
})).text();
const apis = [...new Set([...t.matchAll(/\/api\/v1\/[^"'\\s]+/g)].map((m) => m[0]))];
console.log("apis", apis);
const idx = t.indexOf("/api/v1/cc/search");
if (idx >= 0) console.log(t.slice(idx - 80, idx + 600));

for (const path of apis.filter((p) => /search|stock|list|detail/i.test(p)).slice(0, 15)) {
  for (const method of ["GET", "POST"]) {
    const r = await fetch(`https://www.kcar.com${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 Chrome/122",
        Referer: "https://www.kcar.com/bc/stockCar/list",
      },
      body: method === "POST" ? JSON.stringify({ page: 1, size: 10, pageNo: 1, pageSize: 10 }) : undefined,
    });
    const body = await r.text();
    if (body.startsWith("{") || body.startsWith("[")) {
      console.log(method, path, r.status, body.slice(0, 500));
    }
  }
}
