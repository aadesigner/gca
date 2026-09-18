const headers = { "User-Agent": "Mozilla/5.0", Accept: "*/*", Referer: "https://fem.encar.com/cars/detail/42602552" };
const html = await (await fetch("https://fem.encar.com/cars/detail/42602552", { headers })).text();
const assets = [...html.matchAll(/\/assets\/[^"']+\.js/g)].map(m=>m[0]);
console.log("assets", [...new Set(assets)]);
for (const a of [...new Set(assets)].slice(0,12)) {
  const t = await (await fetch("https://fem.encar.com"+a, { headers, signal: AbortSignal.timeout(20000) })).text();
  if (t.length < 5000) { console.log(a, "small", t.length); continue; }
  const hits = [...new Set([...t.matchAll(/v1\/readside\/[a-zA-Z0-9_\/${}.-]+/g)].map(m=>m[0]))];
  const interesting = hits.filter(h=>/record|mile|inspect|diagn|recall|accident|history|insurance|open|vehicle/i.test(h));
  console.log(a, "len", t.length, "hits", interesting.length);
  if (interesting.length) console.log(interesting.slice(0,40).join("\n"));
  // also search korean mileage strings near API
  if (/주행거리|보험이력|소유자변경|리콜/.test(t)) console.log(" has korean history terms");
}
