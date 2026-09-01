/**
 * Run with: pnpm tsx src/lib/__tests__/vehicle-extra.test.ts
 */
import {
  buildVehicleExtra,
  filterTimelineEvents,
  isExtraSpecEvent,
} from "../vehicle-extra";

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

console.log("\n=== isExtraSpecEvent ===");
assert(
  isExtraSpecEvent({
    eventType: "other",
    description: "Keys available: Yes",
    metadata: { field: "keys", value: "Yes" },
  }),
  "keys metadata is extra",
);
assert(
  !isExtraSpecEvent({
    eventType: "owner_change",
    description: "Owner change",
    metadata: { source: "encar_record" },
  }),
  "owner_change is not extra",
);
assert(
  !isExtraSpecEvent({
    eventType: "other",
    description: "License plate: 12가3456",
    metadata: { field: "plate", value: "12가3456" },
  }),
  "Korean plate is not extra",
);
assert(
  !isExtraSpecEvent({
    eventType: "inspection",
    description: "Autowini inspection report uploaded",
    metadata: { field: "inspectionReportUploaded" },
  }),
  "inspection is not extra",
);

console.log("\n=== buildVehicleExtra ===");
const extra = buildVehicleExtra([
  {
    eventType: "other",
    description: "Keys available: Yes",
    occurredAt: "2024-06-01",
    metadata: { field: "keys", value: "Yes", source: "copart" },
  },
  {
    eventType: "accident",
    description: "Front end",
    occurredAt: "2024-06-01",
    metadata: { source: "iaa", condition: "Run & Drive" },
  },
  {
    eventType: "owner_change",
    description: "Transfer",
    occurredAt: "2023-01-01",
    metadata: { source: "encar_record" },
  },
]);
assert(extra != null && extra.length === 2, "builds keys + condition from accident meta");
assert(Boolean(extra?.some((r) => r.key === "keys" && r.value === "Yes")), "keys row present");
assert(Boolean(extra?.some((r) => r.key === "condition" && r.value === "Run & Drive")), "condition row present");

console.log("\n=== filterTimelineEvents ===");
const timeline = filterTimelineEvents([
  {
    eventType: "other",
    description: "Keys available: Yes",
    metadata: { field: "keys", value: "Yes" },
  },
  {
    eventType: "accident",
    description: "Primary damage: Front",
    metadata: { field: "primary_damage", value: "Front" },
  },
  {
    eventType: "title_status",
    description: "Title: Salvage",
    metadata: { field: "title_type", value: "Salvage" },
  },
  {
    eventType: "sale",
    description: "Sold",
    metadata: { field: "sale" },
  },
  {
    eventType: "owner_change",
    description: "Transfer",
    metadata: {},
  },
  {
    eventType: "inspection",
    description: "Regular inspection passed",
    metadata: { source: "encar_record" },
  },
]);
assert(!timeline.some((e) => /keys available/i.test(e.description ?? "")), "keys removed from timeline");
assert(!timeline.some((e) => e.eventType === "accident"), "accidents removed from timeline");
assert(!timeline.some((e) => e.eventType === "title_status"), "title removed from timeline");
assert(!timeline.some((e) => e.eventType === "sale"), "sale removed from timeline");
assert(!timeline.some((e) => e.eventType === "owner_change"), "owner_change removed from timeline");
assert(timeline.some((e) => e.eventType === "inspection"), "inspection stays in timeline");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
