const vins = [
  { vin: "WDDLJ9HB7HA197121", url: null },
  { vin: "WBA5C3108ED767542", url: null },
];
// resolve URLs from WP API
for (const row of vins) {
  const api = await fetch(`https://koreaauto.auction/wp-json/wp/v2/vehicle?search=${row.vin}&per_page=5`, {
    headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
  });
  const arr = await api.json();
  const hit = (arr||[]).find(x => (x.slug||"").toLowerCase().includes(row.vin.toLowerCase()) || (x.content?.rendered||"").includes(row.vin) || (x.excerpt?.rendered||"").includes(row.vin));
  console.log(row.vin, "hits", arr?.length, hit?.link, hit?.id, hit?.title?.rendered);
  row.url = hit?.link;
  row.id = hit?.id;
}

import { writeFileSync } from "fs";
import { load } from "../artifacts/api-server/node_modules/cheerio/dist/esm/index.js";

for (const row of vins) {
  if (!row.url) continue;
  const html = await (await fetch(row.url, { headers: { "user-agent": "Mozilla/5.0" } })).text();
  writeFileSync(`_kaa_${row.vin}.html`, html);
  const media = await (await fetch(`https://koreaauto.auction/wp-json/wp/v2/media?parent=${row.id}&per_page=40`, { headers: { "user-agent": "Mozilla/5.0", accept: "application/json" } })).json();
  console.log("\n", row.vin, "media_parent", media.map?.(m => m.source_url));
  const $ = load(html);
  console.log("title", $("h1").first().text().trim());
  console.log("engine_stat", (()=>{ let f=""; $(".content").each((_,el)=>{ if($(el).find("span").first().text().trim().toLowerCase()==="engine") f=$(el).find("h6").first().text().trim(); }); return f; })());
  console.log("fuel", (()=>{ let f=""; $(".content").each((_,el)=>{ if(/fuel/i.test($(el).find("span").first().text())) f=$(el).find("h6").first().text().trim(); }); return f; })());
  // specs
  for (const lab of ["Model year","Color","Fuel type","Transmission type","Engine"]) {
    const re = new RegExp(lab+"\\\\s*:\\\\s*(.+)","i");
  }
  const text = $(".price-model-and-fav-area").closest(".container,.container-fluid,section").first().text().replace(/\\s+/g," ").trim().slice(0,500);
  console.log("main_snip", $.root().text().match(/Engine[\\s\\S]{0,40}/)?.[0]);
  console.log("0.0L?", /0\\.0\\s*L/i.test(html));
  console.log("gallery imgs with other vins", [...html.matchAll(/storage\\/[^\"']+\\.(?:jpe?g|png|webp)/gi)].map(m=>m[0]).filter(u => !u.toLowerCase().includes(row.vin.toLowerCase())).slice(0,8));
}
