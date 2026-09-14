import { createRequire } from "node:module";
import { FinnHistoricalAdapter } from "../../artifacts/api-server/src/lib/providers/finn.ts";

const require = createRequire(
  new URL("../../artifacts/api-server/package.json", import.meta.url),
);
const cheerio = require("cheerio");

const a = new FinnHistoricalAdapter("https://www.finn.no", {});
const page = await a.discoverListings(1);
const ref = page.listings![3] ?? page.listings![0];
const f = await a.fetchListing(ref.url);
const html = f.html ?? "";
const $ = cheerio.load(html);
const dts = $("dt")
  .map((_: number, el: cheerio.Element) => $(el).text().trim())
  .get()
  .slice(0, 50);
console.log("url", ref.url);
console.log("htmlLen", html.length);
console.log("dts", dts);
const i = html.toLowerCase().indexOf("understell");
console.log(
  "understell",
  i >= 0 ? html.slice(Math.max(0, i - 80), i + 220).replace(/\s+/g, " ") : null,
);
const p = await a.parseListing(f);
console.log("parsed", {
  vin: p.vin,
  title: p.title,
  mileage: p.mileage,
  price: p.price,
  photos: p.photos?.length,
});
