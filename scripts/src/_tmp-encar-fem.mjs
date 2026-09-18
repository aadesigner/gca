const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0", Accept: "*/*", Referer: "https://fem.encar.com/" };
const id = "42602552"; // 9 owners, has accidents
// Fetch detail page and hunt API URLs related to record/mileage/insurance
const page = await fetch(`https://fem.encar.com/cars/detail/${id}`, { headers, signal: AbortSignal.timeout(20000) });
const html = await page.text();
console.log("page", page.status, html.length);
const urls = [...html.matchAll(/https?:\/\/[^"'\\\s]+/g)].map(m=>m[0]).filter(u=>/api\.encar|record|mileage|insurance|accident|inspect|recall|kidi|carhistory/i.test(u));
console.log("urls", [...new Set(urls)].slice(0,40));
const paths = [...html.matchAll(/["'](\/[^"']*(?:record|mileage|accident|inspect|recall|history)[^"']*)["']/gi)].map(m=>m[1]);
console.log("paths", [...new Set(paths)].slice(0,40));
// JS bundles
const scripts = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m=>m[1]).slice(0,15);
console.log("scripts", scripts);
for (const s of scripts.slice(0,8)) {
  const u = s.startsWith("http") ? s : `https://fem.encar.com${s}`;
  try {
    const t = await (await fetch(u, { headers, signal: AbortSignal.timeout(15000) })).text();
    const hits = [...t.matchAll(/readside\/[a-zA-Z0-9_\/{}]+/g)].map(m=>m[0]);
    const uniq = [...new Set(hits)].filter(h=>/record|mile|inspect|diagn|recall|accident|history|insurance|open/i.test(h));
    if (uniq.length) console.log("bundle", s.slice(-40), uniq.slice(0,30));
  } catch(e) { console.log("script fail", e.message); }
}
