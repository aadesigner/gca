const ab = await (await fetch("https://www.autobell.co.kr/buycar/searchList?tab=1&page=1", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
})).text();
const scripts = [...ab.matchAll(/src=\"(\/_next\/static[^\"]+\.js)\"/g)].map((m) => m[1]);
console.log("scripts", scripts.length);
for (const s of scripts.slice(0, 12)) {
  const t = await (await fetch(`https://www.autobell.co.kr${s}`, { headers: { "User-Agent": "Mozilla/5.0 Chrome/122" } })).text();
  if (!/searchList|buycar|carList|goodsNo|carNo|vin/i.test(t)) continue;
  console.log("\n===", s, t.length);
  const snippets = [];
  for (const key of ["searchList", "buycar", "goodsNo", "carSeq", "getCar", "/api/"]) {
    let pos = 0;
    while ((pos = t.indexOf(key, pos)) >= 0 && snippets.length < 20) {
      snippets.push(t.slice(Math.max(0, pos - 60), pos + 120).replace(/\s+/g, " "));
      pos += key.length;
    }
  }
  console.log(snippets.slice(0, 8).join("\n---\n"));
}

for (const url of [
  "https://www.autobell.co.kr/api/t",
  "https://autobell.co.kr/api/t",
  "https://www.autobell.co.kr/api/buycar/searchList",
  "https://www.autobell.co.kr/buycar/searchList.json?page=1",
]) {
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 Chrome/122", Accept: "application/json" },
  });
  console.log("\n", url, r.status, (await r.text()).slice(0, 400));
}
