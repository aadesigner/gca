/**
 * Assert Bidscan condition comes from the main lot, not Similar Lots.
 */
import assert from "node:assert/strict";
import {
  parseBidscanDetail,
  stripBidscanRelatedCarsHtml,
} from "../providers/bidscan-parse";

const html = `
<html><body>
  <h1>2016 Kia Sorento</h1>
  <div class="flex items-center gap-2"><span class="text-gray-600">Condition:</span><span class="font-bold">ENHANCED VEHICLES</span></div>
  <div><span>Primary Damage</span><span>BURN - ENGINE</span></div>
  <dt>Primary Damage</dt><dd>BURN - ENGINE</dd>
  <dt>Secondary Damage</dt><dd>BURN - INTERIOR</dd>
  <dt>Auction</dt><dd>COPART</dd>
  <!-- Similar Lots -->
  <div class="flex flex-col w-full">
    <div class="text-gray-600 text-xs font-normal">Condition</div>
    <div class="text-gray-600 text-xs font-bold">RUN AND DRIVE</div>
  </div>
  <div class="flex flex-col w-full">
    <div class="text-gray-600 text-xs font-normal">Condition</div>
    <div class="text-gray-600 text-xs font-bold">RUN AND DRIVE</div>
  </div>
</body></html>
`;

assert.ok(!stripBidscanRelatedCarsHtml(html).includes("RUN AND DRIVE"), "strip removes similar-lot conditions");

const listing = parseBidscanDetail(html, "https://bidscan.vin/cars/5XYPH4A57GG162866");
const accident = listing.events?.find((e) => e.eventType === "accident" || e.eventType === "flood_damage");
const condition =
  accident?.metadata && typeof accident.metadata === "object"
    ? String((accident.metadata as Record<string, unknown>).condition ?? "")
    : "";

assert.equal(condition.toUpperCase(), "ENHANCED VEHICLES");
assert.ok(!/run\s*and\s*drive/i.test(condition), "must not leak similar-lot RUN AND DRIVE");
console.log("bidscan-condition.test.ts: ok");
