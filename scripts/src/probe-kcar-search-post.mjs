const bodies = [
  { page: 1, pageSize: 20 },
  { pageNo: 1, rowCount: 20 },
  { currentPage: 1, pageSize: 20, stockCarYn: "Y" },
  { searchType: "stockCar", page: 1, size: 20 },
  {},
];
for (const body of bodies) {
  const r = await fetch("https://www.kcar.com/api/v1/cc/search/", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 Chrome/122",
      Referer: "https://www.kcar.com/bc/stockCar/list",
      Origin: "https://www.kcar.com",
    },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  console.log(JSON.stringify(body), r.status, t.slice(0, 600));
}

// grep setParam in chunk
const js = await (await fetch("https://www.kcar.com/_nuxt/5a3aaf5.js", { headers: { "User-Agent": "Mozilla/5.0 Chrome/122" } })).text();
const idx = js.indexOf("setParam");
console.log("\nsetParam samples:");
let pos = 0;
for (let i = 0; i < 5; i++) {
  pos = js.indexOf("setParam", pos);
  if (pos < 0) break;
  console.log(js.slice(pos, pos + 400).replace(/\s+/g, " "));
  pos += 8;
}
