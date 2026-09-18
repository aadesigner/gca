import assert from "node:assert/strict";
import { translateEncarComment } from "../providers/encar-locale.ts";
import {
  buildBodyCondition,
  extractBodyConditionFromDiagnosis,
  panelsFromEncarDiagnosisComments,
} from "../body-condition.ts";

const noAccident = translateEncarComment(
  "본 차량은 엔카의 진단 결과 모든 항목이 정상으로 확인되며,  '무사고' 차량으로 판정합니다.",
);
const noReplace = translateEncarComment(
  "본 차량의 진단 결과 외부패널의 교환이 없는 차량입니다.\n운)쿼터손상 / 중고차 특성상 부분적인 판금 도색은 있을 수 있습니다.",
);
const yesReplace = translateEncarComment(
  "본 차량은 엔카의 진단 결과 외부 패널 교환 차량입니다. (FRP) 판금 및 도장된 차량입니다",
);

console.log({ noAccident, noReplace, yesReplace });
assert.match(String(noAccident), /no-accident|all items normal/i);
assert.match(String(noReplace), /no outer-panel replacements/i);
assert.doesNotMatch(String(noReplace), /classified as an outer-panel replacement vehicle/i);
assert.match(String(yesReplace), /outer-panel replacement|FRP/i);

const clear = extractBodyConditionFromDiagnosis({
  diagnosisDate: "20260910",
  diagnosisNo: 543,
  items: [
    { name: "HOOD", resultCode: "NORMAL", result: "정상" },
    { name: "FRONT_DOOR_LEFT", resultCode: "NORMAL", result: "정상" },
    { name: "CHECKER_COMMENT", result: "x" },
  ],
});
assert.ok(clear);
assert.equal(clear!.allClear, true);
assert.equal(clear!.panels.length, 0);

const built = buildBodyCondition([
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
]);
assert.ok(built);
assert.equal(built!.allClear, true);
assert.equal(built!.panels.length, 0);

const fromKo = panelsFromEncarDiagnosisComments([
  "본 차량의 진단 결과 외부패널의 교환이 없는 차량입니다.\n운)쿼터손상 / 중고차 특성상 부분적인 판금 도색은 있을 수 있습니다.",
]);
assert.ok(fromKo.some((p) => p.key === "REAR_FENDER_LEFT"), "Korean 운)쿼터손상 → left rear quarter");

console.log("encar-diagram-fix.test.ts: ok");
