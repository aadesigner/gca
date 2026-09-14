/**
 * Import Motor galleries: keep VIN/lot-matching cars2; never prefer foreign IAA stock.
 * Run: ../../scripts/node_modules/.bin/tsx src/lib/__tests__/import-motor-photos.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeIaaiVisUrl, isJunkPhotoUrl } from "../providers/web-html";
import { parseImportMotorDetail } from "../providers/import-motor-parse";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, "../../../../../scripts/_im_mi.html");
assert.ok(fs.existsSync(fixture), `missing fixture ${fixture}`);

const deepzoom =
  "https://vis.iaai.com/deepzoom?imageKey=46367818~SID~B441~S0~I6~RW2576~H1932~TH0&level=12&x=0&y=0";
const rewritten = normalizeIaaiVisUrl(deepzoom);
assert.match(rewritten, /vis\.iaai\.com\/resizer\?/);
assert.ok(rewritten.includes("imageKeys=46367818~SID~B441~S0~I6"));
assert.ok(!/~RW\d+/i.test(rewritten));
assert.equal(isJunkPhotoUrl(rewritten), false);
assert.equal(isJunkPhotoUrl("https://vis.iaai.com/deepzoom"), true);

const html = fs.readFileSync(fixture, "utf8");
const listing = parseImportMotorDetail(html, "https://import-motor.com/v/2G1FA1E35D9105508");
const photos = listing.photos ?? [];
const iaai = photos.filter((p) => /vis\.iaai\.com\/resizer/i.test(p.sourceUrl));
const cars = photos.filter((p) => /cars2?\.import-motor\.com/i.test(p.sourceUrl));
const lot = listing.sourceId?.replace(/^im-/i, "");

// This fixture embeds IAA deepzoom stock 46367818 while cars2 + Lot number use 45868848.
// Prefer the lot-matching cars2 gallery; never attribute the foreign IAA stock.
assert.ok(lot && /^\d+$/.test(lot), `expected numeric lot sourceId, got ${listing.sourceId}`);
assert.ok(cars.length >= 5, `expected cars2 gallery for lot ${lot}, got ${cars.length}`);
assert.equal(iaai.length, 0, `foreign IAA stock must not replace lot gallery, got ${iaai.length}`);
assert.ok(
  photos.every((p) => {
    const stock =
      p.sourceUrl.match(/\/(?:iaai|copart)\/[^/]+\/[^/]+\/\d{4}\/(\d{6,})\//i)?.[1] ||
      p.sourceUrl.match(/[?&](?:imageKeys?|partitionKey)=(\d{6,})/i)?.[1];
    return !stock || stock === lot;
  }),
  "every stock-bearing URL must match listing lot",
);
assert.ok(photos.every((p) => !/\/deepzoom/i.test(p.sourceUrl)), "raw deepzoom must not be stored");

console.log(`import-motor-photos: ok (${photos.length} photos, ${cars.length} cars2, ${iaai.length} iaai, lot=${lot})`);
