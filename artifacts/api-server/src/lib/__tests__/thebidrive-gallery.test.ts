/**
 * TheBidrive gallery must keep only the LD catalog folder — never Similar preload thumbs.
 */
import assert from "node:assert/strict";
import {
  galleryUrls,
  isThebidrivePlaceholderPhoto,
  parseEmbeddedBidriveListing,
} from "../providers/thebidrive";

{
  const html = `
  <script type="application/ld+json">{"@type":"Car","image":[
    "https://cdn.thebidrive.com/autowini/catalog/IC5203892/0.jpg",
    "https://cdn.thebidrive.com/autowini/catalog/IC5203892/1.jpg",
    "https://cdn.thebidrive.com/autowini/catalog/IC5203892/2.jpg"
  ]}</script>
  <link rel="preload" as="image" href="https://cdn.thebidrive.com/autowini/catalog/IC5203892/0.jpg"/>
  <link rel="preload" as="image" href="https://cdn.thebidrive.com/autowini/catalog/IC5203892/3.jpg"/>
  <link rel="preload" as="image" href="https://cdn.thebidrive.com/autowini/catalog/IC5251241/0.jpg"/>
  <link rel="preload" as="image" href="https://cdn.thebidrive.com/autowini/catalog/IC5093570/0.jpg"/>
`;
  const ld = {
    image: [
      "https://cdn.thebidrive.com/autowini/catalog/IC5203892/0.jpg",
      "https://cdn.thebidrive.com/autowini/catalog/IC5203892/1.jpg",
      "https://cdn.thebidrive.com/autowini/catalog/IC5203892/2.jpg",
    ],
  };

  const urls = galleryUrls(html, ld);
  assert.equal(urls.length, 4);
  assert.ok(urls.every((u) => u.includes("IC5203892")));
  assert.ok(!urls.some((u) => u.includes("IC5251241")));
  assert.ok(urls.includes("https://cdn.thebidrive.com/autowini/catalog/IC5203892/3.jpg"));
}

{
  // Encar numeric folders on BidDrive CDN — Similar lots must not leak.
  const html = `
  <meta property="og:image" content="https://cdn.thebidrive.com/encar/42553965/0.jpg"/>
  <img src="https://cdn.thebidrive.com/encar/42553965/1.jpg"/>
  <img src="https://cdn.thebidrive.com/encar/42553965/2.webp"/>
  Similar Lots
  <img src="https://cdn.thebidrive.com/encar/99999999/0.jpg"/>
  <img src="https://cdn.thebidrive.com/autowini/catalog/IC1111111/0.jpg"/>
`;
  const ld = { image: "https://cdn.thebidrive.com/encar/42553965/0.jpg" };
  const urls = galleryUrls(html, ld);
  assert.ok(urls.every((u) => u.includes("/encar/42553965/")));
  assert.ok(!urls.some((u) => u.includes("99999999") || u.includes("IC1111111")));
  assert.ok(urls.includes("https://cdn.thebidrive.com/encar/42553965/2.webp"));
}

{
  // Site change: Car LD+JSON dropped image[]; og:image is a global placeholder.
  const html = `
  <meta property="og:image" content="https://thebidrive.com/og-default.png"/>
  <link rel="preload" as="image" href="https://cdn.thebidrive.com/autowini/catalog/IC5265489/0.jpg"/>
  <link rel="preload" as="image" href="https://cdn.thebidrive.com/autowini/catalog/IC4975750/0.jpg"/>
  sourceUrl\\":\\"https://www.autowini.com/items/Used-2017-Honda-Accord-IC5240804\\"
`;
  const ld = { "@type": "Car", vehicleIdentificationNumber: "JHMCR6650HC200324" };
  const meta = parseEmbeddedBidriveListing(html);
  assert.equal(meta.autowiniIc, "IC5240804");
  const urls = galleryUrls(html, ld, undefined, meta);
  assert.ok(isThebidrivePlaceholderPhoto("https://thebidrive.com/og-default.png"));
  assert.ok(!urls.some((u) => u.includes("og-default")));
  assert.ok(urls.every((u) => u.includes("IC5240804")));
  assert.ok(!urls.some((u) => u.includes("IC5265489")));
}

{
  // No-photo lots: Autowini bg_nodata / Bidrive og-default must never enter the gallery.
  assert.ok(
    isThebidrivePlaceholderPhoto("https://image.autowini.com/resources/IMG/renew/bg/bg_nodata_w800.png"),
  );
  assert.ok(isThebidrivePlaceholderPhoto("https://thebidrive.com/og-default.png"));
  const html = `
  <meta property="og:image" content="https://thebidrive.com/og-default.png"/>
  <script>\\"images\\":[\\"https:\\/\\/image.autowini.com\\/resources\\/IMG\\/renew\\/bg\\/bg_nodata_w800.png\\"]</script>
`;
  const ld = {
    image: [
      "https://thebidrive.com/og-default.png",
      "https://image.autowini.com/resources/IMG/renew/bg/bg_nodata_w800.png",
    ],
  };
  const urls = galleryUrls(html, ld);
  assert.equal(urls.length, 0, `expected empty gallery for no-photo lot, got ${JSON.stringify(urls)}`);
}

console.log("thebidrive-gallery: ok");
