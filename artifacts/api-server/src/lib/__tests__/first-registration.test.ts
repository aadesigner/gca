/**
 * Run with: pnpm tsx src/lib/__tests__/first-registration.test.ts
 */
import {
  collapseFirstRegistrationEvents,
  firstRegistrationScore,
  isFirstRegistrationEvent,
  pickBestFirstRegistration,
} from "../providers/web-html";
import { filterTimelineEvents } from "../vehicle-extra";

let passed = 0;
let failed = 0;

function assert(value: boolean, message: string): void {
  if (value) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

const yearFallback = {
  eventType: "delivery" as const,
  description: "First registration: 2017",
  occurredAt: new Date("2017-01-01T00:00:00Z"),
  metadata: {
    kind: "firstRegistration",
    field: "firstRegistration",
    value: "2017",
    source: "productionYear",
    datePrecision: "year",
  },
};

const dayReg = {
  eventType: "delivery" as const,
  description: "First registration: 2017-10-25",
  occurredAt: new Date("2017-10-25T00:00:00Z"),
  metadata: {
    source: "kbchachacha",
    field: "firstRegistration",
    value: "2017-10-25",
  },
};

const wrongYear = {
  eventType: "delivery" as const,
  description: "First registration: 2018",
  occurredAt: new Date("2018-01-01T00:00:00Z"),
  metadata: {
    kind: "firstRegistration",
    field: "firstRegistration",
    value: "2018",
    source: "productionYear",
    datePrecision: "year",
  },
};

console.log("\n=== isFirstRegistrationEvent ===");
assert(isFirstRegistrationEvent(dayReg), "day reg is first registration");
assert(
  isFirstRegistrationEvent({
    eventType: "delivery",
    description: "First registration: 2017",
    metadata: JSON.stringify(yearFallback.metadata),
  }),
  "parses string metadata",
);
assert(
  !isFirstRegistrationEvent({
    eventType: "delivery",
    description: "Bought new in Korea",
    metadata: {},
  }),
  "undated history delivery is not first registration",
);

console.log("\n=== pickBestFirstRegistration ===");
assert(
  pickBestFirstRegistration([yearFallback, dayReg, wrongYear]) === dayReg,
  "prefers registry day over production years",
);
assert(firstRegistrationScore(dayReg) > firstRegistrationScore(yearFallback), "day scores higher than year");

console.log("\n=== collapseFirstRegistrationEvents ===");
const collapsed = collapseFirstRegistrationEvents([
  { eventType: "inspection", description: "OK", occurredAt: new Date("2020-01-01") },
  yearFallback,
  dayReg,
  wrongYear,
]);
assert(collapsed.length === 2, "collapses to inspection + one first reg");
assert(
  collapsed.filter((e) => isFirstRegistrationEvent(e)).length === 1,
  "exactly one first registration remains",
);
assert(
  collapsed.some((e) => e.description === dayReg.description),
  "keeps the best dated first registration",
);

console.log("\n=== filterTimelineEvents ===");
const timeline = filterTimelineEvents([yearFallback, dayReg, wrongYear]);
assert(timeline.length === 1, "timeline keeps a single first registration");
assert(timeline[0]?.description === dayReg.description, "timeline keeps best first registration");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
