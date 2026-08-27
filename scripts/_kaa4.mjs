import { writeFileSync } from "fs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const r = await fetch("https://koreaauto.auction/wp-json/wp/v2/vehicle?per_page=2&_embed=1", { headers: { "user-agent": UA } });
const text = await r.text();
writeFileSync("_kaa_vehicle_full.json", text);
const arr = JSON.parse(text);
const v = arr[0];
console.log("keys", Object.keys(v));
console.log(JSON.stringify({
  id: v.id, slug: v.slug, link: v.link, title: v.title,
  content: v.content?.rendered?.slice(0,300),
  excerpt: v.excerpt?.rendered,
  meta: v.meta,
  acf: v.acf,
  class_list: v.class_list,
  vehicle_brand: v.vehicle_brand,
  vehicle_condition: v.vehicle_condition,
  featured_media: v.featured_media,
}, null, 2));
// dump all non-standard keys
for (const [k,val] of Object.entries(v)) {
  if (["content","guid","_links","_embedded"].includes(k)) continue;
  const s = JSON.stringify(val);
  if (s && s.length < 500) console.log(k, s);
  else if (s) console.log(k, typeof val, s.slice(0,200));
}
console.log("embed media", JSON.stringify(v._embedded?.["wp:featuredmedia"]?.[0]?.source_url));
console.log("embed terms", JSON.stringify(v._embedded?.["wp:term"]?.map(t=>t.map(x=>({tax:x.taxonomy,name:x.name,slug:x.slug})))));
