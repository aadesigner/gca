import { FinnHistoricalAdapter } from "../../artifacts/api-server/src/lib/providers/finn.ts";

const a = new FinnHistoricalAdapter("https://www.finn.no", {});
const page = await a.discoverListings(1);
let withVin = 0;
let without = 0;
let fail = 0;
for (const ref of (page.listings || []).slice(0, 12)) {
  try {
    const f = await a.fetchListing(ref.url);
    const p = await a.parseListing(f);
    if (p.vehicle?.vin || p.vin) {
      withVin++;
      console.log("VIN", p.vehicle?.vin ?? p.vin, p.title?.slice(0, 50));
    } else {
      without++;
      console.log("NO_VIN", ref.sourceId, p.title?.slice(0, 50));
    }
  } catch (e) {
    fail++;
    console.log("ERR", ref.sourceId, e instanceof Error ? e.message : e);
  }
}
console.log({ withVin, without, fail });
