import { writeFileSync } from "fs";
import { load } from "../artifacts/api-server/node_modules/cheerio/dist/esm/index.js";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" } });
  const text = await res.text();
  return { status: res.status, headers: Object.fromEntries([...res.headers]), text, ct: res.headers.get("content-type") };
}

for (const u of [
  "https://koreaauto.auction/wp-json/wp/v2/types",
  "https://koreaauto.auction/wp-json/wp/v2/vehicle?per_page=5",
  "https://koreaauto.auction/wp-json/wp/v2/vehicles?per_page=5",
  "https://koreaauto.auction/wp-json/",
]) {
  const r = await get(u);
  console.log("\n==", u, r.status, "total=", r.headers["x-wp-total"], "pages=", r.headers["x-wp-totalpages"]);
  console.log(r.text.slice(0, 600).replace(/\s+/g," "));
  if (r.status===200) writeFileSync("_kaa_t_"+u.split("/").pop().replace(/\?.*/,"")+".json", r.text.slice(0,100000));
}

const html = (await import("fs")).readFileSync("_kaa_detail.html","utf8");
const $ = load(html);
console.log("\ntitle", $("title").text().trim().slice(0,120));
console.log("h1", $("h1").first().text().replace(/\s+/g," ").trim());
console.log("price candidates");
$(".price, .amount, .woocommerce-Price-amount, [class*=price]").each((i,el)=>{ if(i<8) console.log(" ", $(el).text().replace(/\s+/g," ").trim().slice(0,80)); });
// attribute rows
const labels=[];
$("li, tr, .list-inline-item, .car-attr, .vehicle-attr, .product_meta span").each((i,el)=>{
  const t=$(el).text().replace(/\s+/g," ").trim();
  if(/vin|mileage|fuel|year|engine|color|transmission|location|km/i.test(t) && t.length<120) labels.push(t);
});
console.log("labelish", [...new Set(labels)].slice(0,30));
// og / json-ld
const og=[];
$('meta[property^="og:"], meta[name="description"]').each((_,el)=>og.push($(el).attr("property")||$(el).attr("name"), $(el).attr("content")?.slice(0,120)));
console.log("meta", og.slice(0,20));
$('script[type="application/ld+json"]').each((i,el)=>{
  if(i>2) return;
  const t=$(el).html()?.slice(0,400);
  console.log("ld+json", t?.replace(/\s+/g," "));
});
// main gallery imgs for this vin
const vin="WBA5A7103GG296835";
const imgs=[];
$("img").each((_,el)=>{
  const src=$(el).attr("src")||$(el).attr("data-src")||"";
  if(src.toLowerCase().includes(vin.toLowerCase()) || /2015-BMW-528i/i.test(src)) imgs.push(src);
});
console.log("imgs", [...new Set(imgs)].slice(0,10));
