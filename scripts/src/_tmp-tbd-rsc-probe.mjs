const url =
  process.argv[2] ||
  "https://thebidrive.com/en/listing/72197a6f-d266-4d17-acb0-4ec94c8666b2/2017-honda-accord-jhmcr6650hc200324";
const html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
const uuid = url.match(/([a-f0-9-]{36})/i)?.[1];
const counts = {};
for (const m of html.matchAll(/IC\d{7}/g)) counts[m[0]] = (counts[m[0]] || 0) + 1;
console.log("IC counts", Object.entries(counts).sort((a, b) => b[1] - a[1]));
const apiHits = [...html.matchAll(/\/api\/[a-z0-9/_-]+/gi)].map((m) => m[0]);
console.log("api paths", [...new Set(apiHits)].slice(0, 20));
if (uuid) {
  const idx = html.indexOf(uuid);
  console.log("uuid context", html.slice(idx, idx + 800).replace(/\s+/g, " "));
}
// probe first preload catalog for more frames
const ic = html.match(/\/catalog\/(IC\d+)\/0\./i)?.[1];
if (ic) {
  const found = [];
  for (let i = 0; i < 30; i++) {
    for (const ext of ["jpg", "webp", "avif"]) {
      const u = `https://cdn.thebidrive.com/autowini/catalog/${ic}/${i}.${ext}`;
      const head = await fetch(u, { method: "HEAD" });
      if (head.ok) found.push(u);
    }
  }
  console.log("probe", ic, found.length, found.slice(0, 8));
}
