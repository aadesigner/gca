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

console.log("body-condition.test.ts: ok");
