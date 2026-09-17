/**
 * Salvage record from title + total-loss signals (any country).
 * Run: ../../scripts/node_modules/.bin/tsx src/lib/__tests__/salvage-title.test.ts
 */
import assert from "node:assert/strict";
import {
  buildSalvageRecord,
  isSalvageTitleEvent,
  textIndicatesSalvage,
} from "../salvage-title";

assert.equal(textIndicatesSalvage("Tx - Salvage Vehicle Title"), true);
assert.equal(textIndicatesSalvage("Clear"), false);
assert.equal(textIndicatesSalvage("total_loss"), true);
assert.equal(textIndicatesSalvage("Total loss"), true);
assert.equal(textIndicatesSalvage("전손"), true);
assert.equal(textIndicatesSalvage("Collision"), false);

const usClean = buildSalvageRecord([
  {
    eventType: "title_status",
    description: "Vehicle title: CA - Clean Title",
    metadata: { field: "vehicle_title", value: "CA - Clean Title", salvage: false, region: "US" },
  },
]);
assert.ok(usClean);
assert.equal(usClean!.salvage, false);
assert.match(String(usClean!.title), /Clean/i);

const usSalvage = buildSalvageRecord([
  {
    eventType: "title_status",
    description: "Vehicle title: TX - Salvage Vehicle Title",
    metadata: {
      field: "vehicle_title",
      value: "TX - Salvage Vehicle Title",
      salvage: true,
      region: "US",
    },
  },
]);
assert.ok(usSalvage);
assert.equal(usSalvage!.salvage, true);

const krTotalLoss = buildSalvageRecord([
  {
    eventType: "total_loss",
    description: "Total loss recorded (1 incident(s))",
    metadata: { source: "encar_record", totalLossCnt: 1, salvage: true, region: "KR" },
  },
]);
assert.ok(krTotalLoss, "Korean total_loss must produce a salvage record");
assert.equal(krTotalLoss!.salvage, true);
assert.equal(krTotalLoss!.source, "encar_record");

const carstat = buildSalvageRecord([
  {
    eventType: "total_loss",
    description: "Damage: Total loss",
    metadata: {
      source: "carstat",
      field: "damage",
      damageClass: "total_loss",
      salvage: true,
    },
  },
]);
assert.ok(carstat);
assert.equal(carstat!.salvage, true);
assert.match(String(carstat!.title), /Total loss/i);

const koreaauto = buildSalvageRecord([
  {
    eventType: "total_loss",
    description: "Listed as salvage car",
    metadata: {
      source: "koreaauto_auction",
      field: "vehicle_category",
      value: "salvage-car",
      salvage: true,
    },
  },
]);
assert.ok(koreaauto);
assert.equal(koreaauto!.salvage, true);

assert.equal(
  isSalvageTitleEvent({
    eventType: "accident",
    description: "Insurance claim recorded on 2020-01-01",
  }),
  false,
  "plain accident must not open salvage tab",
);

assert.equal(
  buildSalvageRecord([
    { eventType: "accident", description: "Minor bump" },
  ]),
  null,
);

console.log("salvage-title: ok");
