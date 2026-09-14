const id = "IC5494339";
const paths = [
  `https://m.autowini.com/s/item/${id}`,
  `https://m.autowini.com/s/items/${id}`,
  `https://m.autowini.com/items/${id}`,
  `https://m.autowini.com/s/search/item/${id}`,
  `https://m.autowini.com/s/cars/detail/${id}`,
  `https://m.autowini.com/s/cars/${id}`,
  `https://m.autowini.com/Cars/Used-2009-BMW-Z4-${id}/cars-detail`,
];
for (const url of paths) {
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (iPhone)", Accept: "text/html" },
    redirect: "manual",
  });
  const loc = r.headers.get("location");
  const html = r.status === 200 ? await r.text() : "";
  const imgs = r.status === 200 ? [...new Set(html.match(/imagebox\.autowini\.com[^"'\\\s<>]+/g) ?? [])].length : 0;
  console.log(r.status, loc?.slice(0, 60), "imgs", imgs, url.replace(id, "IC"));
}
