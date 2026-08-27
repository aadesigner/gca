import { load } from "../artifacts/api-server/node_modules/cheerio/dist/esm/index.js";
import { readFileSync } from "fs";
const $ = load(readFileSync("_kaa_detail.html","utf8"));
const root = $(".price-model-and-fav-area").first();
console.log("ROOT HTML len", root.html()?.length);
console.log("ROOT TEXT", root.text().replace(/\s+/g," ").trim().slice(0,500));
const wrap = root.closest(".row");
console.log("ROW TEXT", wrap.text().replace(/\s+/g," ").trim().slice(0,800));
// find km near price area
const after = wrap.parent();
console.log("PARENT TEXT", after.text().replace(/\s+/g," ").trim().slice(0,1000));

// list items with icons
$(".price-model-and-fav-area").first().closest(".container, .container-fluid, section, .row").find("ul li, .car-info li, .vehicle-info li").each((i,el)=>{
  if(i<20) console.log("li", $(el).text().replace(/\s+/g," ").trim());
});

// Search for "107032"
const idx = $.root().html().indexOf("107032");
console.log("context", $.root().html().slice(idx-200, idx+100).replace(/\s+/g," "));
