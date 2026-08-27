const listUrl = "https://market-api.heydealer.com/v2/customers/web/market/cars/?page=1&page_size=20";
const r = await fetch(listUrl, {
  headers: {
    "User-Agent": "Mozilla/5.0 Chrome/122",
    Accept: "application/json",
    Origin: "https://www.heydealer.com",
    Referer: "https://www.heydealer.com/",
  },
});
const t = await r.text();
console.log("list", r.status, t.slice(0, 2000));

let json;
try {
  json = JSON.parse(t);
  const cars = json?.results ?? json?.data ?? json?.cars ?? json;
  const first = Array.isArray(cars) ? cars[0] : cars?.results?.[0];
  console.log("first car keys", first && Object.keys(first));
  console.log("first car", JSON.stringify(first, null, 2).slice(0, 2500));
  const id = first?.hash_id || first?.id || first?.car_id || "byJ6zjyW";
  const detailUrl = `https://market-api.heydealer.com/v2/customers/web/market/cars/${id}/`;
  const dr = await fetch(detailUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 Chrome/122",
      Accept: "application/json",
      Origin: "https://www.heydealer.com",
      Referer: `https://www.heydealer.com/market/cars/${id}`,
    },
  });
  const dt = await dr.text();
  console.log("\ndetail", dr.status, dt.slice(0, 3000));
} catch (e) {
  console.log("parse err", e.message);
}

// sellcar bundle api strings
const js = await (await fetch("https://www.sellcarintl.com/assets/index-BY7pngw6.js", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
})).text();
const hits = [...new Set([...js.matchAll(/\/api\/v1\/[a-zA-Z0-9_/-]+/g)].map((m) => m[0]))];
console.log("\nsellcar api hits", hits.slice(0, 40));

for (const path of hits.slice(0, 15)) {
  const url = `https://www.sellcarintl.com${path}`;
  const resp = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 Chrome/122" },
  });
  const body = await resp.text();
  if (resp.status !== 500 || body.includes('"data"')) {
    console.log(path, resp.status, body.slice(0, 200));
  }
}

// charancha chunk api
const chunk = await (await fetch("https://www.charancha.com/_next/static/chunks/main-app-7dd56bb3b36d6f66.js", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
})).text();
const charApis = [...new Set([...chunk.matchAll(/https?:\/\/[^"'\\s]+/g)].map((m) => m[0]).filter((u) => /charancha|api/i.test(u)))];
console.log("\ncharancha urls", charApis.slice(0, 20));
