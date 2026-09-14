/**
 * Run with: pnpm tsx src/lib/__tests__/encar-accident-type.test.ts
 */
import assert from "node:assert/strict";
import {
  translateEncarAccidentType,
  translateEncarEventDescription,
} from "../providers/encar-locale";
import { buildAccidentTable } from "../accidents";

assert.equal(translateEncarAccidentType("1"), "Damage to this vehicle");
assert.equal(translateEncarAccidentType("2"), "Damage to another vehicle");
assert.equal(translateEncarAccidentType("내차피해"), "Damage to this vehicle");
assert.equal(translateEncarAccidentType("상대차피해"), "Damage to another vehicle");
assert.equal(
  translateEncarEventDescription("Insurance accident(2) on 2025-09-06"),
  "Insurance accident(Damage to another vehicle) on 2025-09-06",
);

const rows = buildAccidentTable([
  {
    eventType: "accident",
    description: "Insurance accident (2) on 2025-09-06 — parts ₩100",
    occurredAt: "2025-09-06",
    metadata: {
      source: "encar_record",
      type: "2",
      rawType: "2",
      date: "2025-09-06",
      currency: "KRW",
      partCost: 100,
      repairTotal: 100,
    },
  },
]);
assert.equal(rows[0]?.category, "Damage to another vehicle");
assert.equal(rows[0]?.partCost, 100);

console.log("encar-accident-type.test.ts: ok");
