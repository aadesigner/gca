/**
 * Run with: pnpm tsx src/lib/__tests__/seobuk-photos.test.ts
 */
import { load } from "cheerio";
import { firstRegEvent } from "../providers/web-html";
import {
  collectSeobukPhotos,
  isSeobukGalleryPhoto,
  isSeobukJunkPhoto,
  SeobukHistoricalAdapter,
} from "../providers/seobuk";

let passed = 0;
let failed = 0;

function assert(value: boolean, message: string): void {
  if (value) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

const userPng = "https://www.seobuk.org/assets/admin/images/user/300/432/se/1782828820699422.png";
const carmanagerJpg = "https://img.carmanager.co.kr/temp/photo/2024/01/car.jpg";
const logo = "https://www.seobuk.org/assets/custom/images/logo.png";
const loading = "https://www.seobuk.org/assets/custom/images/loading.gif";

console.log("\n=== isSeobukJunkPhoto ===");
assert(isSeobukGalleryPhoto(userPng), "user PNG is a gallery photo");
assert(isSeobukGalleryPhoto(carmanagerJpg), "carmanager JPG is a gallery photo");
assert(!isSeobukJunkPhoto(userPng), "user PNG is not junk");
assert(!isSeobukJunkPhoto(carmanagerJpg), "carmanager JPG is not junk");
assert(
  isSeobukGalleryPhoto("https://myshop-img.carmanager.co.kr/temp/photo/2026/20260818/abc.jpg"),
  "myshop-img carmanager photo is gallery",
);
assert(
  !isSeobukJunkPhoto("https://myshop-img.carmanager.co.kr/temp/photo/2026/20260818/abc.jpg"),
  "myshop-img carmanager photo is not junk",
);
assert(
  isSeobukJunkPhoto("https://myshop-img2.carmanager.co.kr/myshop3/admin/images/user/300/432/S20260128_SEOBUK_LOGO.png"),
  "dealer logo PNG is junk",
);
assert(isSeobukJunkPhoto(logo), "site logo is junk");
assert(isSeobukJunkPhoto(loading), "loading.gif is junk");

console.log("\n=== collectSeobukPhotos ===");
const html = `
<html>
  <input id="main_img" value="${carmanagerJpg}" />
  <div class="img-wrap">
    <img data-src="${userPng}" />
    <img src="${logo}" />
    <img src="${loading}" />
  </div>
  <script>var extra = "https:\\/\\/www.seobuk.org\\/assets\\/admin\\/images\\/user\\/300\\/432\\/se\\/999.png";</script>
</html>
`;
const photos = collectSeobukPhotos(load(html), html, carmanagerJpg);
const urls = photos.map((p) => p.sourceUrl);
assert(urls.includes(carmanagerJpg), "keeps main carmanager photo");
assert(urls.includes(userPng), "keeps user gallery PNG from img-wrap");
assert(urls.some((u) => u.endsWith("/999.png")), "keeps escaped user PNG from script");
assert(!urls.includes(logo), "drops site logo");
assert(!urls.includes(loading), "drops loading.gif");
assert(photos.length >= 3, `gallery has ${photos.length} real photos`);

console.log("\n=== parseListing extras ===");
const adapter = new SeobukHistoricalAdapter();
const parsed = await adapter.parseListing({
  url: "https://www.seobuk.org/search/detail/C6EE310DB77E790F0A7716C9CD800D98",
  html: `
    <title>[Mercedes Benz] E-Class W213</title>
    <input id="main_img" value="${carmanagerJpg}" />
    <img src="${userPng}" />
    <table>
      <tr><th>Vehicle year</th><td>2021</td><th>Date of first registration</th><td>2021.07.28</td></tr>
      <tr><th>Fuel</th><td>Gasoline</td><th>Transmission</th><td>Automatic</td></tr>
      <tr><th>Color</th><td>White</td><th>Mileage</th><td>97,870km</td></tr>
      <tr><th>The car's number</th><td>127어1684</td><th>Vehicle identification number</th><td>W1KZF4FB1MA985095</td></tr>
      <tr><th>Model name</th><td>E class</td></tr>
    </table>
  `,
  statusCode: 200,
  headers: {},
});
assert(parsed.vehicle?.vin === "W1KZF4FB1MA985095", "parses VIN");
assert(parsed.vehicle?.model === "E class", "parses model name");
assert((parsed.photos?.length ?? 0) >= 2, "parseListing keeps gallery photos");
assert(
  parsed.events?.some((e) => e.eventType === "delivery" && e.description?.includes("2021.07.28")) === true,
  "first registration becomes delivery event",
);

console.log("\n=== firstRegEvent dotted dates ===");
const delivery = firstRegEvent("2021.07.28");
assert(Boolean(delivery), "parses YYYY.MM.DD");
assert(delivery?.occurredAt.getFullYear() === 2021, "year 2021");
assert(delivery?.occurredAt.getMonth() === 6, "month July");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
