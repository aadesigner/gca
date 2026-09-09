/**
 * TheBidrive gallery must keep only the LD catalog folder — never Similar preload thumbs.
 */
import assert from "node:assert/strict";
import { galleryUrls } from "../providers/thebidrive";

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

console.log("thebidrive-gallery: ok");
