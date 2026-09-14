import { FinnHistoricalAdapter } from "../../artifacts/api-server/src/lib/providers/finn.ts";

const a = new FinnHistoricalAdapter("https://www.finn.no", {});
const page = await a.discoverListings(1);
console.log("discover", {
  n: page.listings?.length,
  sample: page.listings?.slice(0, 3),
  pagination: page.pagination,
});
const first = page.listings?.[0];
if (!first) {
  console.log("no listings");
  process.exit(1);
}
const fetched = await a.fetchListing(first.url);
console.log("fetch", {
  status: fetched.status,
  url: fetched.finalUrl?.slice(0, 100),
  htmlLen: (fetched.html || "").length,
});
const parsed = await a.parseListing(fetched);
console.log("parse", {
  vin: parsed.vin,
  sourceId: parsed.sourceId,
  title: parsed.title?.slice(0, 80),
  photos: parsed.photos?.length,
  price: parsed.priceAmount,
  currency: parsed.priceCurrency,
  mileage: parsed.mileage,
});
