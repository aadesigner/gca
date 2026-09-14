/**
 * Autowini search API caps thumbnails at 5; mobile item SSR carries the full gallery.
 */
import assert from "node:assert/strict";
import {
  isAutowiniPlaceholderPhoto,
  parseAutowiniMobileGalleryHtml,
} from "../providers/autowini-http";
import { collectAutowiniPhotos } from "../providers/autowini-normalize";

{
  assert.ok(isAutowiniPlaceholderPhoto("https://image.autowini.com/resources/IMG/renew/bg/bg_nodata_w800.png"));
  assert.ok(!isAutowiniPlaceholderPhoto("https://imagebox.autowini.com/upload/U1/car/CI1/uuid_1024.jpeg"));
}

{
  const html = `
    <img src="https://imagebox.autowini.com/upload/U1/car/CI1/aaa_720.jpeg"/>
    <img src="https://imagebox.autowini.com/upload/U1/car/CI1/bbb_1024.jpeg"/>
    <img src="https://imagebox.autowini.com/upload/U1/car/CI1/aaa_720.jpeg"/>
    <img src="https://image.autowini.com/resources/IMG/renew/bg/bg_nodata_w800.png"/>
  `;
  const urls = parseAutowiniMobileGalleryHtml(html);
  assert.equal(urls.length, 2);
  assert.ok(urls.every((u) => u.includes("_1024.")));
  assert.ok(urls[0]!.includes("aaa"));
}

{
  const search = {
    photoCount: 20,
    thumbnails: [
      "https://imagebox.autowini.com/upload/U1/car/CI1/aaa_720.jpeg",
      "https://imagebox.autowini.com/upload/U1/car/CI1/bbb_720.jpeg",
      "https://imagebox.autowini.com/upload/U1/car/CI1/ccc_720.jpeg",
      "https://imagebox.autowini.com/upload/U1/car/CI1/ddd_720.jpeg",
      "https://imagebox.autowini.com/upload/U1/car/CI1/eee_720.jpeg",
    ],
    mainThumbnailPath: "https://imagebox.autowini.com/upload/U1/car/CI1/aaa_720.jpeg",
  };
  const mobile = Array.from({ length: 20 }, (_, i) =>
    `https://imagebox.autowini.com/upload/U1/car/CI1/mobile-${i}_1024.jpeg`,
  );
  const photos = collectAutowiniPhotos(search, {}, mobile);
  assert.equal(photos.length, 25);
  assert.ok(photos.every((p) => p.sourceUrl.includes("_1024.")));
  assert.ok(mobile.every((u) => photos.some((p) => p.sourceUrl === u)));
}

console.log("autowini-gallery: ok");
