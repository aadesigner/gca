const sites = [
  "https://www.koreaautotrade.com/eng/car/list.php",
  "https://www.koreaautotrade.com/car/list.php",
  "https://www.autoplus.co.kr/usedcar/list",
  "https://www.carisyou.com/usedcar/list",
  "https://www.heydealer.com/",
  "https://www.shglobalauto.com/inventory",
  "https://www.usedcarkorea.com/",
  "https://www.koreacars.net/",
  "https://www.encar.com/dc/dc_carsearchlist.do",
];

for (const url of sites) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 Chrome/122", "Accept-Language": "en,ko" },
      redirect: "follow",
    });
    const t = await r.text();
    console.log("\n===", url, r.status, t.length);
    const detail = [...new Set([...t.matchAll(/href=["']([^"']*(?:detail|view|car_view|vehicle|stock)[^"']*)["']/gi)].map((m) => m[1]))].slice(0, 8);
    if (detail.length) console.log("links", detail.join("\n  "));
    if (/vin|VIN|chassis|차대/i.test(t)) console.log("has vin text");
    if (/mileage|odometer|주행/i.test(t)) console.log("has mileage text");
  } catch (e) {
    console.log("\n===", url, "ERR", e.message);
  }
}
