const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
// Find a mobile.bg listing with a numeric price
const list = await fetch("https://www.mobile.bg/obiavi/avtomobili-dzhipove", {
  headers: { "User-Agent": UA, "Accept-Language": "bg-BG,bg;q=0.9" },
  signal: AbortSignal.timeout(25000),
});
const buf = Buffer.from(await list.arrayBuffer());
const html = new TextDecoder("windows-1251").decode(buf);
const links = [...html.matchAll(/\/obiava-(\d+)-[^"'\\\s<>]+/g)].map((m) => m[0]);
console.log("list links", new Set(links).size);
for (const path of [...new Set(links)].slice(0, 8)) {
  const url = "https://www.mobile.bg" + path;
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "bg-BG,bg;q=0.9" },
    signal: AbortSignal.timeout(20000),
  });
  const b = Buffer.from(await r.arrayBuffer());
  const t = new TextDecoder("windows-1251").decode(b);
  const price = t
    .match(/class="Price"[^>]*>([\s\S]{0,250})/i)?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const km = [...t.matchAll(/Пробег[^<]*<\/div>\s*<div class="mpInfo">([\s\S]*?)<\/div>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, "").trim(),
  );
  const year = [...t.matchAll(/Дата на производство[^<]*<\/div>\s*<div class="mpInfo">([\s\S]*?)<\/div>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, "").trim(),
  );
  console.log(path.slice(0, 50), "price=", price?.slice(0, 60), "km=", km[0], "year=", year[0]);
}
