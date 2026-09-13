/**
 * Import Motor galleries mix cars2 mirrors with IAAI deepzoom frames.
 * deepzoom must rewrite to resizer?imageKeys= or we keep only ~5 cars2 stills.
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

// Auction CDN present → cars mirrors must be dropped (same shots twice).
assert.equal(cars.length, 0, `expected 0 cars2 mirrors when IAAI frames exist, got ${cars.length}`);
assert.ok(iaai.length >= 5, `expected >=5 IAAI resizer frames, got ${iaai.length}`);
assert.ok(photos.length >= 5, `expected IAAI gallery, got ${photos.length}`);
assert.ok(photos.every((p) => !/\/deepzoom/i.test(p.sourceUrl)), "raw deepzoom must not be stored");

console.log(`import-motor-photos: ok (${photos.length} photos, ${cars.length} cars2, ${iaai.length} iaai)`);
