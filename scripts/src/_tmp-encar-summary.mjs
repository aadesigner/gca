const headers = { "User-Agent": "Mozilla/5.0", Accept: "*/*", Referer: "https://fem.encar.com/" };
const t = await (await fetch("https://fem.encar.com/assets/DetailPage-FV0xXRJG.js", { headers })).text();
// find mileage / recall related string snippets
for (const re of [/recallFullFill[^,]{0,80}/g, /usageChange[^,]{0,80}/g, /mileageState[^,]{0,80}/g, /주행거리[^,]{0,60}/g, /소유자변경[^,]{0,60}/g, /보험이력[^,]{0,80}/g, /리콜[^,]{0,60}/g]) {
  const m = [...t.matchAll(re)].slice(0,5).map(x=>x[0]);
  if (m.length) console.log(re, m);
}
// summary endpoint
const app = await (await fetch("https://fem.encar.com/assets/app-CZCtGgBH.js", { headers })).text();
for (const re of [/record\/vehicle\/\$\{[^}]+\}\/summary[^`]{0,40}/g, /inspection\/vehicle\/\$\{[^}]+\}\/summary[^`]{0,40}/g, /openData[^,]{0,40}/g]) {
  console.log(re, [...app.matchAll(re)].slice(0,3).map(x=>x[0]));
}

const vid = 42600869;
for (const u of [
  `https://api.encar.com/v1/readside/record/vehicle/${vid}/summary`,
  `https://api.encar.com/v1/readside/inspection/vehicle/${vid}/summary`,
  `https://api.encar.com/v1/readside/clean-encar/vehicle/${vid}`,
]) {
  const r = await fetch(u, { headers: { ...headers, Accept: "application/json", Referer: "https://www.encar.com/" } });
  const j = await r.json().catch(()=>null);
  console.log("\n", u, r.status, j && typeof j==='object' ? Object.keys(j) : j);
  if (j && typeof j==='object') console.log(JSON.stringify(j).slice(0,800));
}
