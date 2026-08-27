const r = await fetch("https://www.charancha.com/bu/search/list?page=1&sort=recent", {
  headers: {
    "User-Agent": "Mozilla/5.0 Chrome/122",
    Accept: "text/html",
  },
});
const t = await r.text();
console.log("status", r.status, t.length);
for (const pat of ["sellNo", "carId", "carNumber", "vehicleId", "vin", "mileage", "sellAmt", "modelNm", "carNm"]) {
  const m = t.match(new RegExp(`${pat}[\"':=\\\\s]+([^\"'\\\\s,}{]+)`, "i"));
  if (m) console.log(pat, m[0].slice(0, 80));
}
console.log("has next data", t.includes("__NEXT_DATA__"));
const ld = t.match(/<script type=\"application\/ld\+json\">([\s\S]*?)<\/script>/);
if (ld) console.log("ld+json", ld[1].slice(0, 500));

// try charancha open api from robots/sitemap
for (const url of [
  "https://www.charancha.com/sitemap.xml",
  "https://www.charancha.com/robots.txt",
]) {
  const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Chrome/122" } });
  console.log("\n", url, resp.status, (await resp.text()).slice(0, 400));
}
