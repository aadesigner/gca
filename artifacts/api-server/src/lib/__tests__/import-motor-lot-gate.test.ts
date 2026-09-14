/**
 * Reject related-lot IAA outside fotorama; keep VIN cars2.
 * Also: IM lot ≠ IAA fotorama stock must still keep the full CDN gallery.
 * Run: ../../scripts/node_modules/.bin/tsx src/lib/__tests__/import-motor-lot-gate.test.ts
 */
import assert from "node:assert/strict";
import { parseImportMotorDetail } from "../providers/import-motor-parse";

const VIN = "WVWED71K98W309297";
const LOT = "46102218";
const FOREIGN = "125105596";
const REAL_IAA = "46367818";

// Pollution: related-lot IAA outside fotorama must not replace cars2.
{
  const html = `
<html><body>
  <h1>2008 Volkswagen Golf GTI ${VIN}</h1>
  <div><div>Lot number</div><div>${LOT}</div></div>
  <div><div>Vin</div><div>${VIN}</div></div>
  <div><div>Auction platform</div><div>IAAI</div></div>
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
    "foreign IAA stock outside fotorama must not enter gallery",
  );
  assert.ok(
    photos.every((p) => /cars2\.import-motor\.com/i.test(p.sourceUrl)),
    "without fotorama CDN, keep VIN-bearing cars2",
  );
}

// Full gallery: fotorama IAA stock may differ from IM lot — still keep CDN frames.
{
  const frames = Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    return `<a href="https://vis.iaai.com/deepzoom?imageKey=${REAL_IAA}~SID~B441~S0~I${n}~RW2576~H1932~TH0&amp;level=12&amp;x=0&amp;y=0"></a>`;
  }).join("\n");
  const html = `
<html><body>
  <h1>Camaro ${VIN}</h1>
  <div><div>Lot number</div><div>${LOT}</div></div>
  <div><div>Vin</div><div>${VIN}</div></div>
  <div><div>Auction platform</div><div>IAAI</div></div>
  <img src="https://cars2.import-motor.com/iaai/chevrolet/camaro/2013/${LOT}/${VIN}-1.webp" alt="${VIN}" />
  <img src="https://cars2.import-motor.com/iaai/chevrolet/camaro/2013/${LOT}/${VIN}-2.webp" alt="${VIN}" />
  <img src="https://cars2.import-motor.com/iaai/chevrolet/camaro/2013/${LOT}/${VIN}-3.webp" alt="${VIN}" />
  <div class="fotorama" data-auto="false">
    ${frames}
  </div>
  <script></script>
</body></html>
`;
  const listing = parseImportMotorDetail(html, `https://import-motor.com/v/${VIN}`);
  const photos = listing.photos ?? [];
  const iaai = photos.filter((p) => /vis\.iaai\.com\/resizer/i.test(p.sourceUrl));
  assert.ok(iaai.length >= 8, `expected full IAA gallery despite lot≠stock, got ${iaai.length}`);
  assert.ok(
    iaai.every((p) => p.sourceUrl.includes(REAL_IAA)),
    "CDN frames must be fotorama stock",
  );
  assert.ok(
    photos.every((p) => !p.sourceUrl.includes(FOREIGN)),
    "must not mix foreign stock",
  );
}

console.log("import-motor-lot-gate: ok");
