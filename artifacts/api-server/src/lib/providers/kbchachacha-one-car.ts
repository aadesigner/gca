/**
 * One-car extraction check for KB ChaChaCha.
 * Run: pnpm exec tsx artifacts/api-server/src/lib/providers/kbchachacha-one-car.ts
 */
import { KbchachachaHistoricalAdapter } from "./kbchachacha";
import { kbDetailUrl } from "./kbchachacha-http";
import { parseKbSearchHtml } from "./kbchachacha-normalize";
import { kbFetchSearch } from "./kbchachacha-http";

const TEST_SEQ = "28671404";
const EXPECTED_VIN = "YSM4ZPAA5TF440678";

async function main() {
  const adapter = new KbchachachaHistoricalAdapter();
  const fetched = await adapter.fetchListing(kbDetailUrl(TEST_SEQ));
  const listing = await adapter.parseListing(fetched);
  const vin = adapter.extractVIN(listing);
  const hangul = JSON.stringify(listing).match(/[\uAC00-\uD7AF]+/g) ?? [];
  const plates = hangul.filter((w) => /\d/.test(w) || w.length <= 6);

  console.log(JSON.stringify({
    sourceId: listing.sourceId,
    title: listing.title,
    priceAmount: listing.priceAmount,
    priceCurrency: listing.priceCurrency,
    mileage: listing.mileage,
    location: listing.location,
    listingStatus: listing.listingStatus,
    accidentCount: listing.accidentCount,
    ownerChangeCount: listing.ownerChangeCount,
    vehicle: listing.vehicle,
    photoCount: listing.photos?.length ?? 0,
    photos: listing.photos?.slice(0, 3),
    events: listing.events?.map((e) => ({ type: e.eventType, description: e.description })),
    vin,
    vinOk: vin === EXPECTED_VIN,
    leftoverHangul: hangul.filter((w) => !plates.includes(w) && w !== listing.vehicle?.vin),
  }, null, 2));

  const searchHtml = await kbFetchSearch({ page: 1 });
  const cards = parseKbSearchHtml(searchHtml);
  console.log("searchPage1", { count: cards.length, sample: cards.slice(0, 3) });

  if (vin !== EXPECTED_VIN) {
    throw new Error(`VIN mismatch: got ${vin}, expected ${EXPECTED_VIN}`);
  }
  if (listing.priceAmount !== 76_900_000) {
    throw new Error(`Price mismatch: got ${listing.priceAmount}`);
  }
  if (listing.vehicle?.make !== "Polestar") {
    throw new Error(`Make mismatch: got ${listing.vehicle?.make}`);
  }
  if (listing.vehicle?.model !== "Polestar 4") {
    throw new Error(`Model mismatch: got ${listing.vehicle?.model}`);
  }
  if (listing.vehicle?.trim !== "Long Range Dual Motor") {
    throw new Error(`Trim mismatch: got ${listing.vehicle?.trim}`);
  }
  if (listing.vehicle?.fuelType !== "Electric") {
    throw new Error(`Fuel mismatch: got ${listing.vehicle?.fuelType}`);
  }
  const firstReg = listing.events?.find((e) => e.eventType === "delivery")?.description;
  if (!firstReg?.includes("2025-09-05")) {
    throw new Error(`First registration mismatch: got ${firstReg}`);
  }
  const testCard = cards.find((c) => c.carSeq === TEST_SEQ);
  if (!testCard?.title || !testCard.thumbnail) {
    throw new Error(`Search card incomplete: ${JSON.stringify(testCard)}`);
  }
  console.log("ONE_CAR_OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
