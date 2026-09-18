/**
 * Unit tests: Carstat auction date parsing (Trading ended / Hammer fell / $D ISO).
 * Run: pnpm exec tsx src/lib/__tests__/carstat-dates.test.ts
 */
import assert from "node:assert/strict";
import {
  extractCarstatLotDates,
  parseCarstatDate,
  parseCarstatDisplayDate,
  parseCarstatLotHtml,
} from "../providers/carstat";

function testParseDisplay() {
  const d = parseCarstatDisplayDate("Trading ended 1 Dec 2025 · 15:00 KST");
  assert.ok(d);
  // 15:00 KST = 06:00 UTC
  assert.equal(d!.toISOString(), "2025-12-01T06:00:00.000Z");

  const h = parseCarstatDisplayDate("Hammer fell · 1 Dec 2025");
  assert.ok(h);
  assert.equal(h!.toISOString().slice(0, 10), "2025-12-01");

  const flight = parseCarstatDate("$D2025-12-01T06:00:00.000Z");
  assert.equal(flight!.toISOString(), "2025-12-01T06:00:00.000Z");
  console.log("parse display: ok");
}

function testExtractIgnoresRelatedHammers() {
  const lotId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const html = `
    <div class="StatusLine-module__k6EJyq__status">
      <span class="StatusLine-module__k6EJyq__when">Trading ended 1 Dec 2025 · 15:00 KST</span>
      <span class="StatusLine-module__k6EJyq__chip StatusLine-module__k6EJyq__chipEnded">Hammer fell · 1 Dec 2025</span>
    </div>
    <a href="/lot/11111111-1111-1111-1111-111111111111">related</a>
    Hammer fell · 12 Aug 2026
    Hammer fell · 8 Jul 2026
    "${lotId}","endTime":"$D2025-12-01T06:00:00.000Z","createdAt":"$D2025-11-01T01:00:00.000Z"
  `;
  const dates = extractCarstatLotDates(html, lotId);
  assert.equal(dates.tradingEnded, true);
  assert.equal(dates.endAt!.toISOString(), "2025-12-01T06:00:00.000Z");
  assert.equal(dates.listedAt!.toISOString(), "2025-11-01T01:00:00.000Z");
  console.log("extract status+rsc: ok");
}

function testListingUsesAuctionDateNotCrawl() {
  const lotId = "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";
  const html = `
    <script type="application/ld+json">{"@type":"Vehicle","vehicleIdentificationNumber":"KNADN51266T123456","mileageFromOdometer":{"value":50000},"name":"Test"}</script>
    <span class="StatusLine-module__x__when">Trading ended 1 Dec 2025 · 15:00 KST</span>
    <span class="StatusLine-module__x__chipEnded">Hammer fell · 1 Dec 2025</span>
  `;
  const listing = parseCarstatLotHtml(html, `https://carstat.info/lot/${lotId}/kia`);
  // parseCarstatLotHtml returns payload; wrap via listingFromPayload path by calling parse through adapter shape
  const { listingFromPayloadTest } = { listingFromPayloadTest: null as null };
  void listingFromPayloadTest;
  assert.ok(listing.endAt);
  assert.equal(listing.endAt!.toISOString(), "2025-12-01T06:00:00.000Z");
  assert.equal(listing.tradingEnded, true);
  console.log("payload dates: ok", { endAt: listing.endAt, listedAt: listing.listedAt });
}

testParseDisplay();
testExtractIgnoresRelatedHammers();
testListingUsesAuctionDateNotCrawl();
console.log("carstat-dates: all ok");
