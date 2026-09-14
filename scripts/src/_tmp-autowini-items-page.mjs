const id = process.argv[2] || "IC5494339";
const url = `https://www.autowini.com/items/Used-2009-BMW-Z4-${id}`;
const r = await fetch(url, {
  headers: {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    Accept: "text/html",
    Referer: "https://www.autowini.com/",
  },
  redirect: "follow",
});
const html = await r.text();
console.log("status", r.status, "final", r.url, "len", html.length);
const imgs = [...html.matchAll(/https?:\/\/imagebox\.autowini\.com[^"'\\\s<>]+/gi)].map((m) => m[0]);
console.log("imagebox count", new Set(imgs).size);
console.log([...new Set(imgs)].slice(0, 25));

const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
console.log("ld+json blocks", ld?.length);

const photoCount = html.match(/photoCount["']?\s*[:=]\s*(\d+)/i);
console.log("photoCount", photoCount?.[1]);
