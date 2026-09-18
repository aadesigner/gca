/**
 * Auto Partner + NFS Auto: VIN/lot photo isolation.
 * Run: ../../scripts/node_modules/.bin/tsx src/lib/__tests__/autopartner-nfsauto-photos.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectAutopartnerPhotos,
  extractAutopartnerSearchRefs,
  parseAutopartnerDetail,
} from "../providers/autopartner-parse";
import {
  collectNfsPhotos,
  extractNfsLotRefs,
  parseNfsautoDetail,
} from "../providers/nfsauto-parse";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");

{
  const search = fs.readFileSync(path.join(fixtures, "autopartner-search.html"), "utf8");
  const refs = extractAutopartnerSearchRefs(search);
  assert.ok(refs.length >= 5, `expected search VINs, got ${refs.length}`);
  assert.ok(refs.every((r) => /\/v\/[A-HJ-NPR-Z0-9]{17}$/i.test(r.url)));
  console.log(`autopartner-search: ok (${refs.length} refs)`);
}

{
  const html = fs.readFileSync(path.join(fixtures, "autopartner-detail.html"), "utf8");
  const vin = "5NPEC4AC1DH602234";
  const photos = collectAutopartnerPhotos(html, vin);
  assert.ok(photos.length >= 3, `expected >=3 VIN photos, got ${photos.length}`);
  assert.ok(
    photos.every((p) => p.sourceUrl.toUpperCase().includes(vin)),
    "every photo must contain page VIN",
  );
  const listing = parseAutopartnerDetail(html, `https://cars.autopartner.by/v/${vin}`);
  assert.equal(listing.vehicle?.vin, vin);
  assert.ok((listing.photos?.length ?? 0) >= 3);
  assert.ok(
    (listing.photos ?? []).every((p) => p.sourceUrl.toUpperCase().includes(vin)),
    "parsed listing must not keep related-car photos",
  );
  assert.ok((listing.mileage ?? 0) > 1000, `expected mileage, got ${listing.mileage}`);
  console.log(
    `autopartner-detail: ok (photos=${listing.photos?.length}, mileage=${listing.mileage}, make=${listing.vehicle?.make})`,
  );
}

{
  const html = fs.readFileSync(path.join(fixtures, "nfsauto-lot.html"), "utf8");
  const lotId = "42370022";
  const photos = collectNfsPhotos(html, lotId);
  assert.ok(photos.length >= 5, `expected >=5 lot photos, got ${photos.length}`);
  assert.ok(
    photos.every((p) => p.sourceUrl.includes(lotId) || /nfsauto\.by\/static\/uploads/i.test(p.sourceUrl)),
    "photos must be this lot (or site upload), not related lots",
  );
  const foreign = photos.filter(
    (p) => /ci\.encar\.com/i.test(p.sourceUrl) && !p.sourceUrl.includes(lotId),
  );
  assert.equal(foreign.length, 0, `foreign encar frames: ${foreign.map((p) => p.sourceUrl).join(", ")}`);

  const listing = parseNfsautoDetail(html, `https://nfsauto.by/lot/korea-${lotId}`);
  assert.equal(listing.vehicle?.vin, "KNARK81GBRA320427");
  assert.ok((listing.photos?.length ?? 0) >= 5);
  assert.ok((listing.mileage ?? 0) > 1000);
  console.log(
    `nfsauto-lot: ok (photos=${listing.photos?.length}, mileage=${listing.mileage}, vin=${listing.vehicle?.vin})`,
  );
}

{
  const html = `
    <a href="/lot/korea-11111">a</a>
    <a href="/lot/china-22222">b</a>
    <a href="/lot/korea-11111">dup</a>
  `;
  const all = extractNfsLotRefs(html);
  assert.equal(all.length, 2);
  const kr = extractNfsLotRefs(html, "korea");
  assert.equal(kr.length, 1);
  assert.equal(kr[0]!.sourceId, "nfs-korea-11111");
  console.log("nfsauto-refs: ok");
}

console.log("autopartner-nfsauto-photos: all ok");
