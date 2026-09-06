const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const url =
  "https://www.mobile.bg/obiava-21783411745471022-mercedes-benz-glc-220-d-nalichna-amg-line-4matic";
const res = await fetch(url, {
  headers: { "User-Agent": UA, "Accept-Language": "bg-BG,bg;q=0.9" },
  signal: AbortSignal.timeout(25000),
});
const buf = Buffer.from(await res.arrayBuffer());
const ct = res.headers.get("content-type") || "";
const meta = buf.toString("latin1").match(/charset=([^\s"';>]+)/i)?.[1];
console.log("ct", ct, "meta", meta, "status", res.status);
const t1251 = new TextDecoder("windows-1251").decode(buf);
const t8 = buf.toString("utf8");
const title = (t) =>
  t
    .match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    ?.slice(0, 100);
console.log("utf8 title", title(t8));
console.log("1251 title", title(t1251));
console.log("1251 пробег", /пробег/i.test(t1251), "цена", /цена|лв|€/i.test(t1251));
const price = t1251
  .match(/class="Price"[^>]*>([\s\S]{0,400})/i)?.[1]
  ?.replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");
console.log("1251 price", price?.slice(0, 200));
const labels = [...t1251.matchAll(/class="mpLabel">([\s\S]*?)<\/div>\s*<div class="mpInfo">([\s\S]*?)<\/div>/gi)]
  .slice(0, 10)
  .map((m) => [m[1].replace(/<[^>]+>/g, "").trim(), m[2].replace(/<[^>]+>/g, "").trim()]);
console.log("params", labels);
