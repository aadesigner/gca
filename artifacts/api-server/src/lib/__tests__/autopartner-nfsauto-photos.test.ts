/**
 * Auto Partner + NFS Auto: JSON-first parse + photo isolation (no HTML fixtures).
 * Run: ../../scripts/node_modules/.bin/tsx src/lib/__tests__/autopartner-nfsauto-photos.test.ts
 */
import assert from "node:assert/strict";
import {
  collectAutopartnerPhotos,
  extractAutopartnerSearchRefs,
  parseAutopartnerDetail,
} from "../providers/autopartner-parse";
import {
  collectNfsPhotosFromUrls,
  extractNfsLotRefs,
  parseNfsautoLotJson,
  type NfsLotJson,
} from "../providers/nfsauto-parse";

{
  const searchBlob = `
    <a href="https://cars.autopartner.by/v/5NPEC4AC1DH602234">a</a>
    <a href="/v/W1NFB5KB4RB102752">b</a>
    <a href="https://cars.autopartner.by/v/5NPEC4AC1DH602234">dup</a>
  `;
  const refs = extractAutopartnerSearchRefs(searchBlob);
  assert.ok(refs.length >= 2, `expected search VINs, got ${refs.length}`);
  assert.ok(refs.every((r) => /\/v\/[A-HJ-NPR-Z0-9]{17}$/i.test(r.url)));
  console.log(`autopartner-search: ok (${refs.length} refs)`);
}

{
  const vin = "5NPEC4AC1DH602234";
  const html = `
    <script type="application/ld+json">{"@type":"Vehicle","name":"2013 Hyundai Sonata","modelDate":2013,"brand":{"name":"Hyundai"},"model":"Sonata","color":"Blue","vehicleIdentificationNumber":"${vin}","description":"Odometer 286180 km"}</script>
    <div class="break-inside-avoid flex items-baseline py-2">
      <span class="text-gray-500 dark:text-gray-400 flex-shrink-0 pr-2">Привод</span>
      <span class="flex-grow border-b border-dotted"></span>
      <div class="flex-shrink-0 pl-2">Передний привод</div>
    </div>
    <div class="break-inside-avoid flex items-baseline py-2">
      <span class="text-gray-500 dark:text-gray-400 flex-shrink-0 pr-2">Топливо</span>
      <span class="flex-grow border-b border-dotted"></span>
      <div class="flex-shrink-0 pl-2">Бензин</div>
    </div>
    <div class="break-inside-avoid flex items-baseline py-2">
      <span class="text-gray-500 dark:text-gray-400 flex-shrink-0 pr-2">Трансмиссия</span>
      <span class="flex-grow border-b border-dotted"></span>
      <div class="flex-shrink-0 pl-2">АКПП</div>
    </div>
    <div class="break-inside-avoid flex items-baseline py-2">
      <span class="text-gray-500 dark:text-gray-400 flex-shrink-0 pr-2">Цвет</span>
      <span class="flex-grow border-b border-dotted"></span>
      <div class="flex-shrink-0 pl-2">Синий</div>
    </div>
    <img src="https://image.autopartner.by/copart/hyundai/sonata/2013/123456/${vin}-1-full.webp"/>
    <img src="https://image.autopartner.by/copart/hyundai/sonata/2013/123456/${vin}-2-full.webp"/>
    <img src="https://image.autopartner.by/copart/hyundai/sonata/2013/999999/OTHERVIN000000001-1-full.webp"/>
    Дата аукциона 28.09.2026 16:00
  `;
  const photos = collectAutopartnerPhotos(html, vin);
  assert.ok(photos.length >= 2, `expected >=2 VIN photos, got ${photos.length}`);
  assert.ok(photos.every((p) => p.sourceUrl.toUpperCase().includes(vin)));
  const listing = parseAutopartnerDetail(html, `https://cars.autopartner.by/v/${vin}`);
  assert.equal(listing.vehicle?.vin, vin);
  assert.equal(listing.vehicle?.driveType, "FWD");
  assert.equal(listing.vehicle?.fuelType, "Gasoline");
  assert.equal(listing.vehicle?.transmission, "Automatic");
  assert.equal(listing.vehicle?.color, "Blue");
  assert.ok((listing.mileage ?? 0) > 1000);
  console.log(`autopartner-detail: ok (drive=${listing.vehicle?.driveType}, fuel=${listing.vehicle?.fuelType})`);
}

{
  const lotId = "42370022";
  const lot: NfsLotJson = {
    source: "korea",
    sourceId: `nfs-korea-${lotId}`,
    slug: `korea-${lotId}`,
    encarOrChinaLotId: lotId,
    displayName: "Kia New Sorento 4 th generation HEV 1.6 2 WD Signature",
    brand: "Kia",
    title: "Kia New Sorento 4 th generation HEV 1.6 2 WD Signature, 2024, 28 742 km",
    priceByn: 93465.6,
    year: 2024,
    fuelRaw: "Гибрид",
    engineCc: 1600,
    mileageKm: 28742,
    vin: "KNARK81GBRA320427",
    specs: {
      model: "New Sorento 4 th generation HEV 1.6 2 WD Signature",
      year: "2024",
      mileage: "28742",
      fuel: "Гибрид",
      drive: "Передний",
      transmission: "—",
      color: "Белый",
      body: "Внедорожник",
      engine: "1,6",
    },
    publishDateRaw: "18 августа 2026",
    galleryUrls: [
      `https://ci.encar.com/carpicture07/pic4237/${lotId}_001.jpg`,
      `https://ci.encar.com/carpicture07/pic4237/${lotId}_002.jpg`,
      `https://ci.encar.com/carpicture07/pic4237/99999999_001.jpg`,
    ],
    fxTotals: { BYN: 130819, USD: 43204.53, KRW: 58534610, CNY: 289332, EUR: 37660 },
  };
  const photos = collectNfsPhotosFromUrls(lot.galleryUrls, lotId);
  assert.ok(photos.every((p) => p.sourceUrl.includes(lotId)));
  const listing = parseNfsautoLotJson(lot);
  assert.equal(listing.vehicle?.vin, "KNARK81GBRA320427");
  assert.equal(listing.country, "South Korea");
  assert.equal(listing.vehicle?.driveType, "FWD");
  assert.equal(listing.vehicle?.fuelType, "Hybrid");
  assert.equal(listing.priceCurrency, "USD");
  assert.ok((listing.priceAmount ?? 0) > 1000);
  assert.equal(listing.sourceListedAt?.toISOString().slice(0, 10), "2026-08-18");
  assert.ok(!/[А-Яа-яЁё]/.test([listing.vehicle?.fuelType, listing.vehicle?.driveType].join(" ")));
  console.log(
    `nfsauto-korea: ok (usd=${listing.priceAmount}, listed=${listing.sourceListedAt?.toISOString().slice(0, 10)})`,
  );
}

{
  const lot: NfsLotJson = {
    source: "china",
    sourceId: "nfs-china-58700759",
    slug: "china-58700759",
    encarOrChinaLotId: "58700759",
    displayName: "MINI CLUBMAN 1.6 L COOPER Cheer",
    brand: "Mini",
    priceByn: 17170,
    year: 2010,
    fuelRaw: "Бензин",
    mileageKm: 160000,
    vin: "WMWZB31060T123456",
    specs: { fuel: "Бензин", drive: "Передний", model: "CLUBMAN" },
    publishDateRaw: "28 июля 2026",
    galleryUrls: ["https://nfsauto.by/media/encar/24989848"],
    fxTotals: { BYN: 55308, USD: 18250 },
  };
  const listing = parseNfsautoLotJson(lot);
  assert.equal(listing.country, "China");
  assert.equal(listing.vehicle?.country, "China");
  assert.equal(listing.vehicle?.fuelType, "Gasoline");
  assert.equal(listing.sourceListedAt?.toISOString().slice(0, 10), "2026-07-28");
  console.log(`nfsauto-china: ok (country=${listing.country})`);
}

{
  const html = `
    <a href="/lot/korea-11111">a</a>
    <a href="/lot/china-22222">b</a>
    <a href="/lot/korea-11111">dup</a>
  `;
  const refs = extractNfsLotRefs(html);
  assert.equal(refs.length, 2);
  assert.ok(refs.some((r) => r.sourceId === "nfs-korea-11111"));
  assert.ok(refs.some((r) => r.sourceId === "nfs-china-22222"));
  console.log("nfsauto-refs: ok");
}

console.log("autopartner-nfsauto-photos: all ok");
