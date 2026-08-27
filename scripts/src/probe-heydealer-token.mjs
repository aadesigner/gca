const home = await fetch("https://www.heydealer.com/", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
});
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
const initCookies = init.headers.getSetCookie?.() ?? [];
cookieHeader = [...homeCookies, ...initCookies].map((c) => c.split(";")[0]).join("; ");
const token = initJson?.token?.token ?? initJson?.token;
console.log("token", token);

for (const auth of [
  `Token ${token}`,
  `Bearer ${token}`,
  token,
]) {
  const list = await fetch("https://market-api.heydealer.com/v2/customers/web/market/cars/?page=1&page_size=5", {
    headers: {
      "User-Agent": "Mozilla/5.0 Chrome/122",
      Accept: "application/json",
      Origin: "https://www.heydealer.com",
      Referer: "https://www.heydealer.com/",
      Cookie: cookieHeader,
      Authorization: auth,
      "App-Os": "web",
    },
  });
  console.log("auth", auth.slice(0, 20), list.status, (await list.text()).slice(0, 400));
}

const id = "byJ6zjyW";
const detail = await fetch(`https://market-api.heydealer.com/v2/customers/web/market/cars/${id}/`, {
  headers: {
    "User-Agent": "Mozilla/5.0 Chrome/122",
    Accept: "application/json",
    Origin: "https://www.heydealer.com",
    Referer: `https://www.heydealer.com/market/cars/${id}`,
    Cookie: cookieHeader,
    Authorization: `Token ${token}`,
    "App-Os": "web",
  },
});
console.log("detail", detail.status, (await detail.text()).slice(0, 1500));
