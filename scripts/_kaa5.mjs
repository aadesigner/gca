import { load } from "../artifacts/api-server/node_modules/cheerio/dist/esm/index.js";
import { readFileSync, writeFileSync } from "fs";
const html = readFileSync("_kaa_detail.html","utf8");
const $ = load(html);

// Try to find main product section
const candidates = ["#product-5380",".single-vehicle",".vehicle-details",".car-single",".product", "article", ".elementor-location-single"];
for (const sel of candidates) {
  const n = $(sel).length;
  if (n) console.log("sel", sel, n, $(sel).first().text().replace(/\s+/g," ").trim().slice(0,200));
}

// look for price near h1
const h1 = $("h1").first();
console.log("h1 parent classes", h1.parent().attr("class"), h1.closest("section,div,article").attr("class"));

// WooCommerce style
console.log("summary", $(".summary, .entry-summary, .vehicle-summary").text().replace(/\s+/g," ").trim().slice(0,400));

// extract structured fields from page text near start
const body = $("body").clone();
body.find("script,style,nav,footer,header,.related,.woocommerce-Tabs-panel").remove();
// Find block containing this VIN only
const vin="WBA5A7103GG296835";
let mainText="";
$("*").each((_,el)=>{
  const t=$(el).children().length===0?"":null;
});
// Use regex on a trimmed section: from h1 to next vehicle link?
const idx = html.indexOf("2015 BMW 528i");
const snip = html.slice(idx, idx+15000);
writeFileSync("_kaa_snip.html", snip);
const $s = load(snip);
console.log("snip text", $s.text().replace(/\s+/g," ").trim().slice(0,800));

// also fetch media endpoint for gallery
const media = await (await fetch("https://koreaauto.auction/wp-json/wp/v2/media?parent=5380&per_page=20",{headers:{"user-agent":"Mozilla/5.0"}})).json();
console.log("media parent", media.map?.(m=>({id:m.id,url:m.source_url,title:m.title?.rendered})));

// check custom fields plugin
const r = await fetch("https://koreaauto.auction/wp-json/wp/v2/vehicle/5380?context=edit",{headers:{"user-agent":"Mozilla/5.0"}});
console.log("edit context", r.status, (await r.text()).slice(0,200));
