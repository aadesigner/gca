const urls = [
  "https://www.sellcarintl.com/buy-now",
  "https://www.charancha.com/bu/search/list",
  "https://www.kcar.com/",
  "https://www.kcar.com/bc/search",
  "https://www.heydealer.com/market",
  "https://www.autoclick.co.kr/",
  "https://www.bobaedream.co.kr/mycar/mycar_list.php",
  "https://www.lotteautoauction.net/auction/exhibitList.do",
  "https://www.sellcarauction.com/",
  "https://www.koreacars.co.kr/",
];

for (const url of urls) {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 Chrome/122",
        "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
      },
      redirect: "follow",
    });
    const t = await r.text();
    console.log("\n===", url, r.status, t.length);
    const hints = [];
    if (t.includes("__NEXT_DATA__")) hints.push("NEXT_DATA");
    if (t.includes("__NUXT__")) hints.push("NUXT");
    if (/\/api\//i.test(t)) hints.push("api-paths");
    if (/vin|chassis/i.test(t)) hints.push("vin");
    if (/mileage|odometer|주행/i.test(t)) hints.push("mileage");
    console.log("hints:", hints.join(","));
    const detail = [...t.matchAll(/href=["']([^"']*(?:detail|view|vehicle|stock|car)[^"']*)["']/gi)]
      .slice(0, 8)
      .map((m) => m[1]);
    if (detail.length) console.log("links:", detail.join("\n  "));
    const ids = [...t.matchAll(/(?:carId|car_id|vehicleId|seqno|goodsNo|sellNo)[\"'=:\s]+([A-Za-z0-9_-]+)/gi)]
      .slice(0, 5)
      .map((m) => m[0]);
    if (ids.length) console.log("id patterns:", ids.join(" | "));
  } catch (e) {
    console.log("\n===", url, "ERR", e.message);
  }
}
