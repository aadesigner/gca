/**
 * Run: ../../scripts/node_modules/.bin/tsx src/lib/__tests__/iaai-spin-stock.test.ts
 */
import assert from "node:assert/strict";
import {
  extractIaaiSpinStockId,
  extractIaaiStockFromUrls,
  htmlHasIaaiSpinForStock,
  resolveIaaiSpinStockId,
} from "../providers/iaai-spin";

assert.equal(
  extractIaaiSpinStockId(
    `<iframe src="https://vis.iaai.com/Home/ThreeSixtyView?keys=SID-12345678~STP-1&iframeview=true"></iframe>`,
    "99999999",
  ),
  "12345678",
);

assert.equal(
  extractIaaiSpinStockId(
    `<img src="/images/360.png" alt="in 360 degrees"><a href="/copart/ford/escape/2023/90845015/x.webp">`,
    "90845015",
  ),
  undefined,
);

assert.equal(
  extractIaaiSpinStockId(`page mentions vis.iaai.com/Home/ThreeSixtyView for this stock`, "90845015"),
  undefined,
);

assert.equal(
  extractIaaiStockFromUrls([
    "https://cars.import-motor.com/iaai/porsche/911/2026/46071494/WP0AB2A92TS227786-1.webp",
    "https://cars.import-motor.com/iaai/porsche/911/2026/46071494/WP0AB2A92TS227786-2.webp",
  ]),
  "46071494",
);

// Gallery stock wins over unrelated HTML ThreeSixty (similar vehicle)
assert.equal(
  resolveIaaiSpinStockId({
    html: `<iframe src="https://vis.iaai.com/Home/ThreeSixtyView?keys=SID-46571029~STP-1"></iframe>`,
    galleryUrls: [
      "https://cars.import-motor.com/iaai/porsche/911/2026/46071494/WP0AB2A92TS227786-1.webp",
    ],
    sourceId: "im-46071494",
  }),
  "46071494",
);

// Copart gallery paths must not become IAA stock
assert.equal(
  extractIaaiStockFromUrls([
    "https://cars.import-motor.com/copart/ford/escape/2023/90845015/x.webp",
  ]),
  undefined,
);

assert.equal(
  htmlHasIaaiSpinForStock(
    `<iframe src="https://vis.iaai.com/Home/ThreeSixtyView?keys=SID-46024890~STP-1"></iframe>`,
    "46024890",
  ),
  true,
);

assert.equal(
  htmlHasIaaiSpinForStock(
    `https://cars.import-motor.com/iaai/toyota/prius-c/2012/46024890/x.webp`,
    "46024890",
  ),
  false,
);

console.log("iaai-spin-stock.test.ts: ok");
