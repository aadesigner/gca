const js = await (await fetch("https://www.sellcarintl.com/assets/index-BY7pngw6.js", {
  headers: { "User-Agent": "Mozilla/5.0 Chrome/122" },
})).text();
const endpoints = [...js.matchAll(/GET_[A-Z_]+:"([^"]+)"/g)].map((m) => m[1]);
console.log("endpoints", endpoints);

for (const path of endpoints) {
  const url = `https://www.sellcarintl.com/api${path}`;
  for (const method of ["GET", "POST"]) {
    const r = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 Chrome/122",
      },
      body: method === "POST" ? JSON.stringify({ page: 1, pageSize: 10, curPage: 1, rowPerPage: 10 }) : undefined,
    });
    const t = await r.text();
    console.log(method, path, r.status, t.slice(0, 400));
  }
}

// also try direct service path
for (const body of [
  { curPage: 1, rowPerPage: 10 },
  { page: 1, size: 10 },
  {},
]) {
  const r = await fetch("https://www.sellcarintl.com/api/service/v1.0/getCarList.do", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 Chrome/122",
    },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  console.log("getCarList", JSON.stringify(body), r.status, t.slice(0, 600));
}
