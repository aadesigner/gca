/**
 * asPhotos must preserve IAAI imageKeys — stripping ?imageKeys= collapses every
 * lot to the bare vis.iaai.com/resizer path (one wrong / empty image).
 */
import assert from "node:assert/strict";
import { asPhotos, isJunkPhotoUrl, photoIdentityKey } from "../providers/web-html";

const lot = "43210987";
const urls = [0, 1, 2, 3].map(
  (i) => `https://vis.iaai.com/resizer?imageKeys=${lot}~SID~S0~I${i}&width=845&height=633`,
);

assert.equal(isJunkPhotoUrl("https://vis.iaai.com/resizer"), true);
assert.equal(isJunkPhotoUrl(urls[0]!), false);

const keys = new Set(urls.map((u) => photoIdentityKey(u)));
assert.equal(keys.size, 4, "each IAAI frame must have a distinct identity");

const photos = asPhotos(urls);
assert.equal(photos.length, 4);
assert.ok(photos.every((p) => /imageKeys=/i.test(p.sourceUrl)));
assert.ok(photos.every((p) => p.sourceUrl.includes(`imageKeys=${lot}~SID~S0~I`)));

// Empty images[] must not matter — caller merges buckets; asPhotos still dedupes.
const collapsed = asPhotos(urls.map((u) => u.split("?")[0]!));
assert.equal(collapsed.length, 0, "bare resizer without imageKeys is junk / skipped");

console.log("asPhotos-iaai: ok");
