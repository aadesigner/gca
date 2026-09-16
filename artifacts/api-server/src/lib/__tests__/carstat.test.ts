/**
 * Carstat catalog + lot HTML parsers.
 * Run: ../../scripts/node_modules/.bin/tsx src/lib/__tests__/carstat.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  extractCarstatCatalogLots,
  extractCarstatLotHrefs,
  extractCarstatMaxPage,
  parseCarstatDate,
  parseCarstatLotHtml,
  carstatDetailUrl,
  CarstatHistoricalAdapter,
} from "../providers/carstat";

const TEMP = process.env.TEMP || process.env.TMPDIR || "/tmp";
const catalogPath = path.join(TEMP, "carstat-catalog.html");
const lotPath = path.join(TEMP, "carstat-lot.html");

{
  const d = parseCarstatDate("$D2026-09-28T06:30:00.000Z");
  assert.equal(d?.toISOString(), "2026-09-28T06:30:00.000Z");
}

{
  assert.equal(
    carstatDetailUrl("5e019dd3-92b0-4c5b-b496-01fb01aa78f5", "mercedes-benz", "WDD1J6GB7HF026959"),
    "https://carstat.info/lot/5e019dd3-92b0-4c5b-b496-01fb01aa78f5/mercedes-benz/WDD1J6GB7HF026959",
  );
}

if (fs.existsSync(catalogPath)) {
  const html = fs.readFileSync(catalogPath, "utf8");
  const lots = extractCarstatCatalogLots(html);
  assert.ok(lots.length >= 20, `expected ≥20 lots, got ${lots.length}`);
  assert.ok((extractCarstatMaxPage(html) ?? 0) > 1000);
  assert.ok(extractCarstatLotHrefs(html).length >= 20);
  const withVin = lots.filter((l) => l.vin);
  assert.ok(withVin.length > 0);
  assert.equal(withVin[0]!.vin!.replace(/[^a-z0-9]/gi, "").length, 17);
  console.log(`catalog ok: ${lots.length} lots, ${withVin.length} with VIN, maxPage=${extractCarstatMaxPage(html)}`);
} else {
  console.warn(`skip catalog fixture (missing ${catalogPath})`);
}

if (fs.existsSync(lotPath)) {
  const html = fs.readFileSync(lotPath, "utf8");
  const payload = parseCarstatLotHtml(
    html,
    "https://carstat.info/lot/5e019dd3-92b0-4c5b-b496-01fb01aa78f5/mercedes-benz/WDD1J6GB7HF026959",
    {
      id: "5e019dd3-92b0-4c5b-b496-01fb01aa78f5",
      vin: "wdd1j6gb7hf026959",
      maker: "mercedes-benz",
      model: "e400",
      year: 2017,
      fuel: "gas",
      mileage: 77887,
      capacity: 2996,
      details: { nameEn: "Mercedes-Benz E400 4MATIC Coupe", damageClass: "total_loss" },
    },
  );
  assert.equal(payload.vin, "WDD1J6GB7HF026959");
  assert.equal(payload.mileageKm, 77887);
  assert.match(String(payload.make).toLowerCase(), /mercedes/);
  assert.ok(payload.photos.length >= 10, `photos=${payload.photos.length}`);
  assert.ok(!payload.photos.some((u) => /thumbnail/i.test(u)));
  assert.match(String(payload.damageClass), /total_loss/i);
  assert.ok(payload.damageStamps?.some((s) => /전손|total\s*loss/i.test(s)));
  assert.match(String(payload.lotNumber), /D26-/);

  const adapter = new CarstatHistoricalAdapter();
  const listing = await adapter.parseListing({
    url: payload.sourceUrl,
    html,
    json: payload,
    statusCode: 200,
    headers: {},
  });
  assert.equal(listing.vehicle?.vin, "WDD1J6GB7HF026959");
  assert.ok((listing.events?.length ?? 0) >= 1);
  assert.ok((listing.photos?.length ?? 0) >= 10);
  console.log(
    `lot ok: vin=${listing.vehicle?.vin} photos=${listing.photos?.length} events=${listing.events?.length} lot=${payload.lotNumber}`,
  );
} else {
  console.warn(`skip lot fixture (missing ${lotPath})`);
}

console.log("carstat.test.ts passed");
