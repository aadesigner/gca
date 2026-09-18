/**
 * Run with: ../../scripts/node_modules/.bin/tsx src/lib/__tests__/body-condition.test.ts
 */
import assert from "node:assert/strict";
import {
  bodyConditionLegendFromStatus,
  buildBodyCondition,
  extractBodyConditionFromDiagnosis,
} from "../body-condition";

assert.equal(bodyConditionLegendFromStatus("REPLACEMENT"), "Z");
assert.equal(bodyConditionLegendFromStatus("REPAIR"), "W");
assert.equal(bodyConditionLegendFromStatus(undefined, "판금"), "W");
assert.equal(bodyConditionLegendFromStatus(undefined, "부식"), "R");
assert.equal(bodyConditionLegendFromStatus("SCRATCH"), "C");
assert.equal(bodyConditionLegendFromStatus(undefined, "요철"), "N");
assert.equal(bodyConditionLegendFromStatus(undefined, "손상"), "P");
assert.equal(bodyConditionLegendFromStatus("NORMAL"), undefined);

const extracted = extractBodyConditionFromDiagnosis({
  diagnosisDate: "20240512",
  diagnosisNo: 99,
  reservationCenterName: "Encar Center",
  items: [
    { name: "HOOD", resultCode: "REPLACEMENT", result: "교환" },
    { name: "FRONT_FENDER_LEFT", resultCode: "SCRATCH", result: "흠집" },
    { name: "FRONT_DOOR_RIGHT", resultCode: "NORMAL", result: "정상" },
    { name: "CHECKER_COMMENT", result: "테스트" },
  ],
});
assert.ok(extracted);
assert.equal(extracted!.panels.length, 2);
assert.equal(extracted!.panels[0]?.legend, "Z");
assert.equal(extracted!.date, "2024-05-12");

const allClear = extractBodyConditionFromDiagnosis({
  diagnosisDate: "20240512",
  items: [
    { name: "HOOD", resultCode: "NORMAL", result: "정상" },
    { name: "FRONT_DOOR_LEFT", resultCode: "NORMAL", result: "정상" },
  ],
});
assert.ok(allClear);
assert.equal(allClear!.allClear, true);
assert.equal(allClear!.panels.length, 0);

// OUTER_PANEL_COMMENT notes damage while item codes stay NORMAL → not all-clear.
const commentDamage = extractBodyConditionFromDiagnosis({
  diagnosisDate: "20260910",
  diagnosisNo: 543,
  items: [
    { name: "HOOD", resultCode: "NORMAL", result: "정상" },
    { name: "FRONT_DOOR_LEFT", resultCode: "NORMAL", result: "정상" },
    {
      name: "OUTER_PANEL_COMMENT",
      result:
        "본 차량의 진단 결과 외부패널의 교환이 없는 차량입니다.\n운)쿼터손상 / 중고차 특성상 부분적인 판금 도색은 있을 수 있습니다.",
    },
  ],
});
assert.ok(commentDamage);
assert.ok(!commentDamage!.allClear);
assert.ok(commentDamage!.panels.some((p) => p.key === "REAR_FENDER_LEFT"));
assert.equal(commentDamage!.panels.find((p) => p.key === "REAR_FENDER_LEFT")?.legend, "P");

const fromCommentEvents = buildBodyCondition([
  {
    eventType: "inspection",
    metadata: {
      source: "encar_diagnosis",
      bodyCondition: true,
      allClear: true,
      panels: [],
      date: "2026-09-10",
    },
  },
  {
    eventType: "other",
    description:
      "Encar diagnosis: no outer-panel replacements. rear quarter damage noted / As typical for used cars, minor panel repair / repaint may exist",
    metadata: {
      source: "encar_diagnosis",
      comments: [
        "Encar diagnosis: no outer-panel replacements.",
        "rear quarter damage noted / As typical for used cars, minor panel repair / repaint may exist",
      ],
    },
  },
]);
assert.ok(fromCommentEvents);
assert.ok(fromCommentEvents!.panels.some((p) => p.key?.startsWith("REAR_FENDER")));
assert.notEqual(fromCommentEvents!.allClear, true);

const fromEvents = buildBodyCondition([
  {
    eventType: "inspection",
    occurredAt: "2024-05-12",
    metadata: {
      source: "encar_diagnosis",
      bodyCondition: true,
      panels: extracted!.panels,
      diagnosisNo: 99,
      center: "Encar Center",
      date: "2024-05-12",
    },
  },
  {
    eventType: "inspection",
    metadata: {
      source: "encar_inspection_panels",
      panels: [{ panel: "Hood", status: "Replacement" }],
    },
  },
]);
assert.ok(fromEvents);
assert.equal(fromEvents!.panels.some((p) => p.legend === "Z"), true);

// Legacy string panels still parse
const legacy = buildBodyCondition([
  {
    eventType: "inspection",
    metadata: {
      source: "encar_diagnosis",
      panels: ["Front Fender (Left): Scratch", "Trunk Lid: Replacement"],
    },
  },
]);
assert.ok(legacy);
assert.equal(legacy!.panels.length, 2);
assert.equal(legacy!.panels.find((p) => /Trunk/i.test(p.label))?.legend, "Z");

const carstatMap = buildBodyCondition([
  {
    eventType: "total_loss",
    metadata: {
      source: "carstat",
      field: "damage",
      damageClass: "total_loss",
      stamps: ["전손", "측면", "Total loss"],
      salvage: true,
    },
  },
]);
assert.ok(carstatMap);
assert.equal(carstatMap!.source, "carstat");
assert.ok(carstatMap!.panels.some((p) => p.key === "FRONT_DOOR_LEFT" && p.legend === "Z"));

const carstatStampOnly = buildBodyCondition([
  {
    eventType: "total_loss",
    metadata: {
      source: "carstat",
      field: "damage",
      damageClass: "전손",
      stamps: ["전손", "Total loss"],
      zones: [],
      salvage: true,
      stamp: "Total loss",
    },
  },
]);
assert.ok(carstatStampOnly);
assert.equal(carstatStampOnly!.stamp, "Total loss");
assert.equal(carstatStampOnly!.panels.length, 0);

const carstatZones = buildBodyCondition([
  {
    eventType: "total_loss",
    metadata: {
      source: "carstat",
      field: "damage",
      damageClass: "total_loss",
      stamps: ["Total loss"],
      zones: ["front", "engine"],
      salvage: true,
    },
  },
]);
assert.ok(carstatZones);
assert.ok(carstatZones!.panels.some((p) => p.key === "HOOD"));
assert.ok(carstatZones!.panels.some((p) => p.key === "FRONT_BUMPER"));

console.log("body-condition.test.ts: ok");
