import { load } from "../artifacts/api-server/node_modules/cheerio/dist/esm/index.js";
import { readFileSync } from "fs";
const html = readFileSync("_kaa_detail.html","utf8");
const $ = load(html);
const vin = "WBA5A7103GG296835";

// Find elements containing exact price $2,750
$("*").each((_, el) => {
  const own = $(el).clone().children().remove().end().text().replace(/\s+/g," ").trim();
  if (/\$\s*2,?750/.test(own) || own === "$2,750.00") {
    const path=[]; let n=el;
    for(let i=0;i<6 && n;i++){ path.push(`${n.tagName||n.name}.${(n.attribs?.class||"").split(/\s+/).slice(0,3).join(".")}`); n=n.parent; }
    console.log("price_el", path.join(" < "), "text=", $(el).text().replace(/\s+/g," ").trim().slice(0,100));
  }
});

// Model year / Color labels
$("label, .title, span, li, p, div").each((_, el) => {
  const t = $(el).text().replace(/\s+/g," ").trim();
  if (/^Model year:/i.test(t) || /^Color:/i.test(t) || /^Fuel type:/i.test(t) || /^Transmission/i.test(t) || /km\.\s*$/i.test(t) && t.length < 40) {
    if (t.length < 80) console.log("spec", t, "class=", $(el).attr("class"));
  }
});

// gallery in main content - look for slick/swiper
console.log("gallery selectors", {
  gallery: $(".gallery, .vehicle-gallery, .car-gallery, .product-gallery").length,
  slick: $(".slick-slide img").length,
  swiper: $(".swiper-slide img").length,
});

// Approach: parse list card data from list HTML for price/mileage, detail for VIN/photos
const list = readFileSync("_kaa_list.html","utf8");
const $l = load(list);
const cards=[];
$l("a[href*='/vehicle/']").each((_, el) => {
  const href = $l(el).attr("href")||"";
  if (!/\/vehicle\/[^/]+\/?$/.test(href) || /page|feed|brand/.test(href)) return;
  const card = $l(el).closest("div,article,li");
  const text = card.text().replace(/\s+/g," ").trim();
  if (!/\$/.test(text)) return;
  const slug = href.match(/\/vehicle\/([^/]+)\/?/)?.[1];
  if (!slug || cards.some(c=>c.slug===slug)) return;
  cards.push({
    slug,
    href,
    title: card.find("h5,h4,h3,.title").first().text().replace(/\s+/g," ").trim() || text.slice(0,40),
    price: text.match(/\$\s*[\d,]+(?:\.\d+)?/)?.[0],
    km: text.match(/([\d,\s]+)\s*km/i)?.[1],
    loc: text.match(/\b(Incheon|Busan|Seoul|Changwon|Daegu|Gwangju|Gyeonggi|Suwon|Jeonju|Gangwon)\b/i)?.[1],
  });
});
console.log("list_cards", cards.length, cards.slice(0,5));
