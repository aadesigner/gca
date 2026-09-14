const url =
  process.argv[2] ||
  "https://thebidrive.com/en/listing/72197a6f-d266-4d17-acb0-4ec94c8666b2/2017-honda-accord-jhmcr6650hc200324";
const html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
const cut = html.search(/Similar/i);
const main = cut > 0 ? html.slice(0, cut) : html;
const imgs = [...main.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
const preloads = [...main.matchAll(/<link[^>]+rel=["']preload["'][^>]+as=["']image["'][^>]+href=["']([^"']+)["']/gi)].map(
  (m) => m[1],
);
console.log(JSON.stringify({ imgCount: imgs.length, imgs: imgs.slice(0, 15), preloads }, null, 2));
