import { writeFileSync } from "fs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json,text/html,*/*" } });
  const text = await res.text();
  return { status: res.status, headers: Object.fromEntries(res.headers), text, ct: res.headers.get("content-type") };
}

// categories
for (const u of [
  "https://koreaauto.auction/wp-json/wp/v2/product_cat?per_page=100",
  "https://koreaauto.auction/wp-json/wp/v2/product?per_page=3&_fields=id,slug,link,title,type,status,meta,acf,class_list,product_cat",
  "https://koreaauto.auction/wp-json/wp/v2/product?slug=2015-bmw-528i-wba5a7103gg296835",
  "https://koreaauto.auction/wp-json/wc/store/v1/products?per_page=3&category=vehicle",
  "https://koreaauto.auction/wp-json/wc/store/v1/products?per_page=3&orderby=date&order=desc",
]) {
  const r = await get(u);
  console.log("\n==", u, r.status, r.ct, "total=", r.headers["x-wp-total"], "pages=", r.headers["x-wp-totalpages"]);
  console.log(r.text.slice(0, 500).replace(/\s+/g, " "));
  if (r.status===200 && /json/.test(r.ct||"")) writeFileSync("_kaa_"+Buffer.from(u).toString("base64url").slice(0,20)+".json", r.text.slice(0,80000));
}

const detail = await get("https://koreaauto.auction/vehicle/2015-bmw-528i-wba5a7103gg296835/");
writeFileSync("_kaa_detail.html", detail.text);
console.log("\ndetail", detail.status, detail.text.length);
const vin = detail.text.match(/[A-HJ-NPR-Z0-9]{17}/g);
console.log("vins_in_page", [...new Set(vin||[])].slice(0,10));
// look for product attributes
for (const pat of [/VIN[\s\S]{0,80}/i, /Mileage[\s\S]{0,80}/i, /sku[\s\S]{0,60}/i, /woocommerce-product-attributes[\s\S]{0,800}/i, /"offers"[\s\S]{0,400}/]) {
  const m = detail.text.match(pat);
  if (m) console.log("match", pat.source.slice(0,40), m[0].replace(/\s+/g," ").slice(0,200));
}
