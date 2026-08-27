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

const list = await fetch("https://market-api.heydealer.com/v2/customers/web/market/cars/?page=1&page_size=3", { headers });
const listJson = await list.json();
console.log("list status", list.status, "count", listJson.length);
console.log(JSON.stringify(listJson[0], null, 2));

const id = listJson[0]?.hash_id;
for (const url of [
  `https://market-api.heydealer.com/v2/customers/web/market/cars/${id}/`,
  `https://market-api.heydealer.com/v2/customers/web/market/cars/${id}`,
  `https://api.heydealer.com/v2/customers/web/market/cars/${id}/`,
]) {
  const r = await fetch(url, { headers: { ...headers, Referer: `https://www.heydealer.com/market/cars/${id}` } });
  const t = await r.text();
  console.log("\n", url, r.status, t.slice(0, 1200));
}

// pagination
const list2 = await fetch("https://market-api.heydealer.com/v2/customers/web/market/cars/?page=2&page_size=3", { headers });
console.log("\npage2", list2.status, (await list2.text()).slice(0, 300));
