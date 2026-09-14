import { FinnHistoricalAdapter } from "../../artifacts/api-server/src/lib/providers/finn.ts";
import * as cheerio from "cheerio";

const a = new FinnHistoricalAdapter("https://www.finn.no", {});
const page = await a.discoverListings(1);
const ref = page.listings![0];
const f = await a.fetchListing(ref.url);
const html = f.html ?? "";
const $ = cheerio.load(html);
const dts = $("dt").map((_,el)=>$(el).text().trim()).get().slice(0,40);
console.log("url", ref.url);
console.log("htmlLen", html.length);
console.log("dts", dts);
const chassisHits = [...html.matchAll(/chassis|understell|VIN|chassisnr|chassis.?nr/gi)].slice(0,20).map(m=>m[0]);
console.log("hits", chassisHits);
// look near understell
const i = html.toLowerCase().indexOf("understell");
console.log("understell idx", i, i>=0 ? html.slice(Math.max(0,i-80), i+200).replace(/\s+/g," ") : null);
const j = html.toLowerCase().indexOf("chassis");
console.log("chassis idx", j, j>=0 ? html.slice(Math.max(0,j-80), j+200).replace(/\s+/g," ") : null);
try {
  const p = await a.parseListing(f);
  console.log("parsed", { vin:p.vin, title:p.title, mileage:p.mileage, price:p.price, photos:p.photos?.length });
} catch(e) {
  console.log("PARSE ERR", e);
}
