const sites = [
  "https://www.sellcar.co.kr/",
  "https://www.sellcar.co.kr/usedcar/list",
  "https://www.autohub.co.kr/",
  "https://www.autohub.co.kr/vehicle/list",
  "https://www.lotteautoauction.net/",
  "https://www.autobell.co.kr/",
  "https://www.kcarauction.com/",
  "https://www.encar.com/",
  "https://www.skencar.com/",
  "https://www.charancha.com/bu/search/list",
  "https://m.charancha.com/bu/search/list",
  "https://www.carmanager.co.kr/",
  "https://www.kbchachacha.com/public/search/main.kbc",
];

for (const url of sites) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 Chrome/122", "Accept-Language": "ko,en" },
      redirect: "follow",
    });
    const t = await r.text();
    console.log("\n===", url, r.status, t.length);
    const patterns = [
      ...new Set([
        ...t.matchAll(/href=["']([^"']*(?:detail|view|vehicle|car|stock|goods|product)[^"']*)["']/gi),
      ].map((m) => m[1])),
    ].slice(0, 10);
    if (patterns.length) console.log("links:", patterns.join("\n  "));
    if (/vin|VIN|chassis|차대/i.test(t)) console.log("vin: yes");
    if (/mileage|odometer|주행/i.test(t)) console.log("mileage: yes");
    if (/__NEXT_DATA__|__NUXT__|application\/json/i.test(t)) console.log("spa/json: yes");
  } catch (e) {
    console.log("\n===", url, "ERR", e.message);
  }
}

// heydealer init + list
const init = await fetch("https://api.heydealer.com/v2/customers/web/initialize_app/", {
  method: "POST",
  headers: {
    "User-Agent": "Mozilla/5.0 Chrome/122",
    Accept: "application/json",
    "Content-Type": "application/json",
    Origin: "https://www.heydealer.com",
    Referer: "https://www.heydealer.com/",
  },
  body: "{}",
});
const initText = await init.text();
console.log("\nheydealer init", init.status, initText.slice(0, 500));
const setCookie = init.headers.getSetCookie?.() ?? [];
console.log("cookies", setCookie.length);

const list = await fetch("https://market-api.heydealer.com/v2/customers/web/market/cars/?page=1&page_size=10", {
  headers: {
    "User-Agent": "Mozilla/5.0 Chrome/122",
    Accept: "application/json",
    Origin: "https://www.heydealer.com",
    Referer: "https://www.heydealer.com/",
    Cookie: setCookie.map((c) => c.split(";")[0]).join("; "),
  },
});
console.log("heydealer list2", list.status, (await list.text()).slice(0, 1000));
