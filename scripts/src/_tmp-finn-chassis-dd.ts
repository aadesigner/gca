import { createRequire } from "node:module";
import { FinnHistoricalAdapter } from "../../artifacts/api-server/src/lib/providers/finn.ts";
const require = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const cheerio = require("cheerio");
const a = new FinnHistoricalAdapter("https://www.finn.no", {});
const page = await a.discoverListings(1);
let found=0;
for (const ref of page.listings!.slice(0,20)) {
  const f = await a.fetchListing(ref.url);
  const $ = cheerio.load(f.html??"");
  const dt = $("dt").filter((_:number,el:any)=>/chassis|vin/i.test($(el).text())).first();
  const dd = dt.next("dd").text().trim();
  const p = await a.parseListing(f);
  console.log(ref.sourceId, "dd=", JSON.stringify(dd.slice(0,40)), "vin=", p.vin, "km=", p.mileage);
  if (p.vin) found++;
}
console.log("found", found);
