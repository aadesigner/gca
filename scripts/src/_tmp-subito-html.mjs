const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const url = "https://www.subito.it/auto/renault-kangoo-messina-659735227.htm";
const res = await fetch(url, {
  headers: { "User-Agent": UA, "Accept-Language": "it-IT,it;q=0.9" },
  signal: AbortSignal.timeout(25000),
});
const html = await res.text();
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
console.log("scripts", scripts.length);
for (const s of scripts) {
  const body = s[1] || "";
  const tag = s[0].slice(0, 120);
  if (/__NEXT|__NUXT|__APOLLO|__PRELOADED|application\/ld\+json|window\./i.test(tag + body.slice(0, 200))) {
    console.log("\nTAG", tag.replace(/\s+/g, " "));
    console.log(body.slice(0, 300).replace(/\s+/g, " "));
  }
}
const ld = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => {
  try {
    return JSON.parse(m[1]);
  } catch {
    return m[1].slice(0, 100);
  }
});
console.log("\nld+json count", ld.length);
for (const x of ld.slice(0, 3)) console.log(JSON.stringify(x).slice(0, 400));

// mileage/price in HTML
console.log("\nKm html", html.match(/[\d.]+\s*Km/i)?.[0]);
console.log("price html", html.match(/[\d.]+\s*€/)?.[0]);
console.log("VIN?", html.match(/VIN[\s\S]{0,40}[A-HJ-NPR-Z0-9]{17}/i)?.[0]);
