/**
 * Run: ../../scripts/node_modules/.bin/tsx src/lib/__tests__/iaai-spin-stock.test.ts
 */
import assert from "node:assert/strict";
import { extractIaaiSpinStockId } from "../providers/iaai-spin";

// Explicit IAA iframe → ok
assert.equal(
  extractIaaiSpinStockId(
    `<iframe src="https://vis.iaai.com/Home/ThreeSixtyView?keys=SID-12345678~STP-1&iframeview=true"></iframe>`,
    "99999999",
  ),
  "12345678",
);

// Copart page with generic "360" marketing + lot — must NOT treat lot as IAA stock
assert.equal(
  extractIaaiSpinStockId(
    `<img src="/images/360.png" alt="in 360 degrees"><a href="/copart/ford/escape/2023/90845015/x.webp">`,
    "90845015",
  ),
  undefined,
);

// Lot fallback only with IAA-specific evidence (and no explicit SID already in HTML)
assert.equal(
  extractIaaiSpinStockId(
    `page mentions vis.iaai.com/Home/ThreeSixtyView for this stock`,
    "90845015",
  ),
  "90845015",
);

// Explicit partitionKey wins over lot arg
assert.equal(
  extractIaaiSpinStockId(
    `mediaretriever.iaai.com/api/ThreeSixtyImageRetriever?tenant=iaai&partitionKey=555`,
    "90845015",
  ),
  "555",
);

console.log("iaai-spin-stock.test.ts: ok");
