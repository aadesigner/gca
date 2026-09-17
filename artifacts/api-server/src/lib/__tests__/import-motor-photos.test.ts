/**
 * Import Motor galleries: fotorama IAA stock may differ from IM lot — keep full CDN gallery.
 * Run: ../../scripts/node_modules/.bin/tsx src/lib/__tests__/import-motor-photos.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeIaaiVisUrl, isJunkPhotoUrl } from "../providers/web-html";
import { parseImportMotorDetail, importMotorPhotoSortKey } from "../providers/import-motor-parse";

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

// Fixture: cars2 uses IM lot 45868848; fotorama deepzoom uses IAA stock 46367818 (same car).
// Full auction CDN gallery must win — do not collapse to thin cars2 mirrors.
assert.ok(lot && /^\d+$/.test(lot), `expected numeric lot sourceId, got ${listing.sourceId}`);
assert.equal(cars.length, 0, `expected 0 cars2 mirrors when IAAI frames exist, got ${cars.length}`);
assert.ok(iaai.length >= 5, `expected >=5 IAAI resizer frames, got ${iaai.length}`);
assert.ok(
  iaai.every((p) => p.sourceUrl.includes("46367818")),
  "IAA frames must be fotorama stock 46367818",
);
assert.ok(photos.every((p) => !/\/deepzoom/i.test(p.sourceUrl)), "raw deepzoom must not be stored");

console.log(`import-motor-photos: ok (${photos.length} photos, ${cars.length} cars2, ${iaai.length} iaai, lot=${lot})`);

// Primary must never be Encar inspection (_010+), which are often VIN/chassis plate shots.
// Copart cars2 -1 is often rear — prefer cs.copart _vhrs / later exterior mirrors.
{
  const hero = "https://cars2.import-motor.com/encar/hyundai/sonata/2020/123/KMHLN4A3XLA000001-1-abc123.webp";
  const plate = "https://ci.encar.com/carpicture/carpicture01/pic4271/42717683_024.jpg";
  const cover = "https://ci.encar.com/carpicture/carpicture01/pic4271/42717683_001.jpg";
  const copartRear =
    "https://cars2.import-motor.com/copart/acura/ilx/2018/68513746/19UDE2F42JA006548-1-abc.webp";
  const copartSide =
    "https://cars2.import-motor.com/copart/acura/ilx/2018/68513746/19UDE2F42JA006548-2-def.webp";
  const copartVhrs =
    "https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/0926/703dddd809c148c1a9af6ce92ff134ee_vhrs.jpg";
  assert.ok(importMotorPhotoSortKey(hero) < importMotorPhotoSortKey(plate), "cars2 -1 beats Encar _024");
  assert.ok(importMotorPhotoSortKey(cover) < importMotorPhotoSortKey(plate), "Encar _001 beats _024");
  assert.ok(importMotorPhotoSortKey(plate) >= 2000, "_024 is demoted as inspection");
  assert.ok(
    importMotorPhotoSortKey(copartVhrs) < importMotorPhotoSortKey(copartRear),
    "Copart _vhrs beats cars2 -1 (rear)",
  );
  assert.ok(
    importMotorPhotoSortKey(copartSide) < importMotorPhotoSortKey(copartRear),
    "Copart cars2 -2 beats demoted -1",
  );
  console.log("import-motor-photos primary-rank: ok");
}

// Copart fotorama mixes cars2 + cs.copart LPP — must MERGE, not pick one host (was collapsing to 4–6).
const thinPath = path.resolve(here, "../../../../../scripts/_im_probe_thin.html");
if (fs.existsSync(thinPath)) {
  const thinHtml = fs.readFileSync(thinPath, "utf8");
  const thinListing = parseImportMotorDetail(thinHtml, "https://import-motor.com/v/19UDE2F42JA006548");
  const thinPhotos = thinListing.photos ?? [];
  const thinCars = thinPhotos.filter((p) => /cars2?\.import-motor\.com/i.test(p.sourceUrl));
  const thinCopart = thinPhotos.filter((p) => /cs\.copart\.com/i.test(p.sourceUrl));
  assert.ok(
    thinPhotos.length >= 10,
    `copart merge expected >=10 photos, got ${thinPhotos.length}`,
  );
  assert.ok(thinCars.length >= 1, "expected some cars2 frames");
  assert.ok(thinCopart.length >= 1, "expected some cs.copart frames");
  console.log(
    `import-motor-photos merge: ok (${thinPhotos.length} photos, ${thinCars.length} cars2, ${thinCopart.length} copart)`,
  );
}