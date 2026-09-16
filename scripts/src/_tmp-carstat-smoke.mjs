/** Smoke: discover page 1 (VIN-only) + parse one lot via dedicated Carstat CDP tabs. */
import { CarstatHistoricalAdapter } from "../../artifacts/api-server/src/lib/providers/carstat.ts";
import { carstatGetViaCdp } from "../../artifacts/api-server/src/lib/providers/carstat-cdp.ts";
import { extractCarstatCatalogLots, extractCarstatLotHrefs } from "../../artifacts/api-server/src/lib/providers/carstat.ts";

if (!process.env.IMPORT_MOTOR_CDP_URL && !process.env.CARSTAT_CDP_URL) {
  process.env.IMPORT_MOTOR_CDP_URL = "http://127.0.0.1:9222";
}

const url = "https://carstat.info/catalog";
const raw = await carstatGetViaCdp(url);
console.log(
  JSON.stringify(
    {
      status: raw.status,
      final: raw.url,
      len: raw.text.length,
      title: (raw.text.match(/<title[^>]*>([^<]*)/i) || [])[1] || "",
      cf: /just a moment/i.test(raw.text.slice(0, 5000)),
      lots: extractCarstatCatalogLots(raw.text).length,
      hrefs: extractCarstatLotHrefs(raw.text).length,
      withVin: extractCarstatCatalogLots(raw.text).filter((l) => l.vin).length,
    },
    null,
    2,
  ),
);

const adapter = new CarstatHistoricalAdapter(undefined, { vinOnly: true, maxPages: 2 });
const disc = await adapter.discoverListings(1);
console.log(
  JSON.stringify(
    {
      discovered: disc.listings.length,
      hasMore: disc.pagination.hasMore,
      totalPages: disc.pagination.totalPages,
      sample: disc.listings.slice(0, 3),
    },
    null,
    2,
  ),
);

if (!disc.listings[0]) {
  console.error("No VIN lots on page 1");
  process.exit(1);
}

const fetched = await adapter.fetchListing(disc.listings[0].url);
const listing = await adapter.parseListing(fetched);
const vehicleExtra = listing.vehicle || {};
console.log(
  JSON.stringify(
    {
      sourceId: listing.sourceId,
      title: listing.title,
      vin: listing.vehicle?.vin,
      mileage: listing.mileage,
      photos: listing.photos?.length,
      events: listing.events?.map((e) => ({ t: e.eventType, d: e.description?.slice(0, 80) })),
      damageType: vehicleExtra.damageType,
      damageZones: vehicleExtra.damageZones,
    },
    null,
    2,
  ),
);
