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

const kor = await save("autohub_search_kor", "https://www.autohub.co.kr/buy/searchKor.asp?page=1");
const korLinks = [...new Set([...kor.matchAll(/detailView\.asp\?[^"'\\s]+/gi)].map((m) => m[0]))].slice(0, 10);
console.log("autohub detail links", korLinks);
if (korLinks[0]) {
  await save("autohub_detail", `https://www.autohub.co.kr/buy/${korLinks[0]}`);
}

// heydealer with proper init
const home = await fetch("https://www.heydealer.com/", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
});
const homeCookies = home.headers.getSetCookie?.() ?? [];
const cookieHeader = homeCookies.map((c) => c.split(";")[0]).join("; ");
const csrf = cookieHeader.match(/csrftoken=([^;]+)/)?.[1];
console.log("heydealer csrf", csrf);
const init = await fetch("https://api.heydealer.com/v2/customers/web/initialize_app/", {
  method: "POST",
  headers: {
    "User-Agent": "Mozilla/5.0 Chrome/122",
    Accept: "application/json",
    "Content-Type": "application/json",
    Origin: "https://www.heydealer.com",
    Referer: "https://www.heydealer.com/",
    Cookie: cookieHeader,
    ...(csrf ? { "X-CSRFToken": decodeURIComponent(csrf) } : {}),
    "App-Os": "web",
  },
  body: JSON.stringify({ referrer_url: "" }),
});
const initCookies = init.headers.getSetCookie?.() ?? [];
const allCookies = [...homeCookies, ...initCookies].map((c) => c.split(";")[0]).join("; ");
const initJson = await init.json().catch(() => null);
console.log("heydealer init", init.status, JSON.stringify(initJson)?.slice(0, 800));
const token = initJson?.token;
const list = await fetch("https://market-api.heydealer.com/v2/customers/web/market/cars/?page=1&page_size=10", {
  headers: {
    "User-Agent": "Mozilla/5.0 Chrome/122",
    Accept: "application/json",
    Origin: "https://www.heydealer.com",
    Referer: "https://www.heydealer.com/",
    Cookie: allCookies,
    ...(token ? { Authorization: `Token ${token}` } : {}),
    "App-Os": "web",
  },
});
const listText = await list.text();
console.log("heydealer list", list.status, listText.slice(0, 2000));
