const id = process.argv[2] || "IC5494339";
const headers = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
  Accept: "application/json",
  Origin: "https://m.autowini.com",
  Referer: "https://m.autowini.com/",
  "wini-code-select-country": "C1570",
};
const r = await fetch(
  `https://v2api.autowini.com/items/cars?condition=C020&keyword=${id}&pageSize=5`,
  { headers },
);
const item = (await r.json()).data?.items?.[0];
console.log(JSON.stringify(item, null, 2));
