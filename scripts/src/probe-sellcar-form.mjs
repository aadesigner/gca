const js = await (await fetch("https://www.sellcarintl.com/assets/index-BY7pngw6.js", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
})).text();
const idx = js.indexOf("getCarList");
console.log(js.slice(idx - 200, idx + 800));

const bodies = [
  new URLSearchParams({ curPage: "1", rowPerPage: "20" }),
  new URLSearchParams({ page: "1", pageSize: "20" }),
];
for (const body of bodies) {
  const r = await fetch("https://www.sellcarintl.com/api/service/v1.0/getCarList.do", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 Chrome/122",
      Origin: "https://www.sellcarintl.com",
      Referer: "https://www.sellcarintl.com/buy-now",
    },
    body,
  });
  console.log("\nform", body.toString(), r.status, (await r.text()).slice(0, 800));
}

// autobell script chunks
const ab = await (await fetch("https://www.autobell.co.kr/buycar/searchList?tab=1&page=1", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
})).text();
const script = [...ab.matchAll(/src=\"(\/_next\/static[^\"]+\.js)\"/g)].map((m) => m[1])[0];
if (script) {
  const t = await (await fetch(`https://www.autobell.co.kr${script}`, { headers: { "User-Agent": "Mozilla/5.0 Chrome/122" } })).text();
  const apis = [...new Set([...t.matchAll(/https?:\/\/[^"'\\s]+/g)].map((m) => m[0]).filter((u) => /glovis|autobell|api/i.test(u)))];
  console.log("\nautobell apis", apis.slice(0, 25));
  const paths = [...new Set([...t.matchAll(/["'](\/api[^"']+)["']/g)].map((m) => m[1]))];
  console.log("autobell /api paths", paths.slice(0, 25));
}
