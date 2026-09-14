/**
 * Reject IAA frames whose stock ≠ Import Motor lot (WVWED71K98W309297 class bug).
 * Run: ../../scripts/node_modules/.bin/tsx src/lib/__tests__/import-motor-lot-gate.test.ts
 */
import assert from "node:assert/strict";
import { parseImportMotorDetail } from "../providers/import-motor-parse";

const VIN = "WVWED71K98W309297";
const LOT = "46102218";
const FOREIGN = "125105596";

const html = `
<html><body>
  <h1>2008 Volkswagen Golf GTI ${VIN}</h1>
  <div>Lot number: ${LOT}</div>
  <div>Vin: ${VIN}</div>
  <div>Auction platform: IAAI</div>
  <div>Color: Black</div>
  <!-- Fotorama missing: related-lot IAA keys still litter page HTML -->
  <img src="https://vis.iaai.com/resizer?imageKeys=${FOREIGN}~SID~B441~S0~I1&width=845&height=633" alt="related" />
  <a href="https://vis.iaai.com/resizer?imageKeys=${FOREIGN}~SID~B441~S0~I2&width=845&height=633">x</a>
  <img src="https://cars2.import-motor.com/iaai/volkswagen/golf/2008/${LOT}/${VIN}-1.webp" alt="${VIN}" />
  <img src="https://cars2.import-motor.com/iaai/volkswagen/golf/2008/${LOT}/${VIN}-2.webp" alt="${VIN}" />
  <img src="https://cars2.import-motor.com/iaai/volkswagen/golf/2008/${LOT}/${VIN}-3.webp" alt="${VIN}" />
  <iframe src="https://vis.iaai.com/Home/ThreeSixtyView?keys=SID-${FOREIGN}~STP-1"></iframe>
</body></html>
`;

const listing = parseImportMotorDetail(html, `https://import-motor.com/v/${VIN}`);
assert.equal(listing.sourceId, `im-${LOT}`);
const photos = listing.photos ?? [];
assert.ok(photos.length >= 3, `expected cars2 gallery, got ${photos.length}`);
assert.ok(
  photos.every((p) => !p.sourceUrl.includes(FOREIGN)),
  "foreign IAA stock must not enter gallery",
);
assert.ok(
  photos.every((p) => p.sourceUrl.includes(`/${LOT}/`) || !/\d{6,}/.test(p.sourceUrl)),
  "every stock-bearing URL must match listing lot",
);
assert.ok(
  photos.every((p) => /cars2\.import-motor\.com/i.test(p.sourceUrl)),
  "prefer VIN-bearing cars2 when CDN stock is foreign",
);

console.log(`import-motor-lot-gate: ok (${photos.length} photos)`);
