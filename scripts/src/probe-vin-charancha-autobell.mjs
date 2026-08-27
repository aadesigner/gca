// get heydealer detail and search for vin
const home = await fetch("https://www.heydealer.com/", { headers: { "User-Agent": "Mozilla/5.0 Chrome/122" } });
const homeCookies = home.headers.getSetCookie?.() ?? [];
let cookieHeader = homeCookies.map((c) => c.split(";")[0]).join("; ");
const init = await fetch("https://api.heydealer.com/v2/customers/web/initialize_app/", {
  method: "POST",
  headers: {
    "User-Agent": "Mozilla/5.0 Chrome/122",
    Accept: "application/json",
    "Content-Type": "application/json",
    Origin: "https://www.heydealer.com",
    Referer: "https://www.heydealer.com/",
    Cookie: cookieHeader,
    "App-Os": "web",
  },
  body: JSON.stringify({ referrer_url: "" }),
});
const initJson = await init.json();
cookieHeader = [...homeCookies, ...(init.headers.getSetCookie?.() ?? [])].map((c) => c.split(";")[0]).join("; ");
const jwt = initJson?.token;
const headers = {
  "User-Agent": "Mozilla/5.0 Chrome/122",
  Accept: "application/json",
  Origin: "https://www.heydealer.com",
  Referer: "https://www.heydealer.com/",
  Cookie: cookieHeader,
  Authorization: jwt,
  "App-Os": "web",
};
const list = await (await fetch("https://market-api.heydealer.com/v2/customers/web/market/cars/?page=1&page_size=1", { headers })).json();
const id = list[0].hash_id;
const detail = await (await fetch(`https://market-api.heydealer.com/v2/customers/web/market/cars/${id}/`, {
  headers: { ...headers, Referer: `https://www.heydealer.com/market/cars/${id}` },
})).json();
console.log(JSON.stringify(detail, null, 2));
const flat = JSON.stringify(detail);
console.log("\nvin search", flat.match(/vin|chassis|차대/gi));

// charancha - fetch a chunk and search for api
const chunks = [
  "https://www.charancha.com/_next/static/chunks/5683-356b2ca820ddbcef.js",
  "https://www.charancha.com/_next/static/chunks/7760-ab10afe3c8c6a87e.js",
];
for (const url of chunks) {
  const t = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Chrome/122" } })).text();
  const apis = [...new Set([...t.matchAll(/["'](\/[^"']*(?:api|search|cars)[^"']*)["']/g)].map((m) => m[1]))].filter((s) => s.includes("api") || s.includes("search"));
  if (apis.length) console.log("\ncharancha apis from", url.split("/").pop(), apis.slice(0, 30));
}

// autobell next data / api from page scripts
const ab = await (await fetch("https://www.autobell.co.kr/buycar/searchList?detailTab=0&filterTab=0&homeSvc=N&listType=card&order=upd_dt&subTab=0&tab=1&viewType=1&page=1", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
})).text();
const scripts = [...ab.matchAll(/src=\"([^\"]+\.js)\"/g)].map((m) => m[1]).slice(0, 8);
console.log("\nautobell scripts", scripts);
for (const s of scripts.slice(0, 5)) {
  const url = s.startsWith("http") ? s : `https://www.autobell.co.kr${s}`;
  const t = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Chrome/122" } })).text();
  const apis = [...new Set([...t.matchAll(/https?:\/\/[^"'\\s]+/g)].map((m) => m[0]).filter((u) => /glovis|autobell|api/i.test(u)))];
  if (apis.length) console.log("autobell api from", s, apis.slice(0, 15));
}

// autohub ajax endpoint from JS
const ah = await (await fetch("https://www.autohub.co.kr/buy/searchKor.asp", { headers: { "User-Agent": "Mozilla/5.0 Chrome/122" } })).text();
const jsfiles = [...ah.matchAll(/src=\"(\/js[^\"]+)\"/g)].map((m) => m[1]);
console.log("\nautohub js", jsfiles.slice(0, 10));
for (const js of jsfiles.slice(0, 5)) {
  const t = await (await fetch(`https://www.autohub.co.kr${js}`, { headers: { "User-Agent": "Mozilla/5.0 Chrome/122" } })).text();
  const apis = [...new Set([...t.matchAll(/[\"'](\/[^\"']+\.asp[^\"']*)[\"']/g)].map((m) => m[1]).filter((p) => /ajax|list|search|detail/i.test(p)))];
  if (apis.length) console.log("autohub asp from", js, apis.slice(0, 20));
}
