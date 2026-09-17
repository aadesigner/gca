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
  isExtraSpecEvent({
    eventType: "other",
    description: "Steering: Left-hand drive",
    metadata: { field: "steeringType", value: "LHD" },
  }),
  "steeringType metadata is extra",
);
assert(
  isExtraSpecEvent({
    eventType: "other",
    description: "Hand left driving",
  }),
  "hand left driving description is extra",
);
assert(
  isExtraSpecEvent({
    eventType: "other",
    description: "Seats: 5",
    metadata: { field: "seats", value: "5" },
  }),
  "seats metadata is extra",
);
assert(
  isExtraSpecEvent({
    eventType: "other",
    description: "120 kW, 5 doors, 5 seats",
    metadata: { source: "autoplac", kind: "specs", powerKw: 120, doors: 5, seats: 5 },
  }),
  "autoplac specs blob is extra",
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
  {
    eventType: "other",
    description: "Steering: LHD",
    occurredAt: "2024-06-01",
    metadata: { field: "steeringType", value: "LHD", source: "autowini" },
  },
  {
    eventType: "other",
    description: "Seats: 5",
    occurredAt: "2024-06-01",
    metadata: { field: "seats", value: "5", source: "autoscout24" },
  },
]);
assert(extra != null && extra.length === 4, "builds keys + condition + steering + seats");
assert(Boolean(extra?.some((r) => r.key === "keys" && r.value === "Yes")), "keys row present");
assert(Boolean(extra?.some((r) => r.key === "condition" && r.value === "Run & Drive")), "condition row present");
assert(Boolean(extra?.some((r) => r.key === "steering_type" && r.value === "Left-hand drive")), "steering extra row present");
assert(Boolean(extra?.some((r) => r.key === "seats" && r.value === "5")), "seats extra row present");

const autoplacExtra = buildVehicleExtra([
  {
    eventType: "other",
    description: "120 kW, 5 doors, 5 seats",
    occurredAt: "2024-06-01",
    metadata: { source: "autoplac", kind: "specs", powerKw: 120, doors: 5, seats: 5 },
  },
]);
assert(Boolean(autoplacExtra?.some((r) => r.key === "doors" && r.value === "5")), "autoplac doors → extra");
assert(Boolean(autoplacExtra?.some((r) => r.key === "seats" && r.value === "5")), "autoplac seats → extra");

console.log("\n=== filterTimelineEvents ===");
const timeline = filterTimelineEvents([
  {
    eventType: "other",
    description: "Keys available: Yes",
    metadata: { field: "keys", value: "Yes" },
  },
  {
    eventType: "other",
    description: "Steering: Left-hand drive",
    metadata: { field: "steeringType", value: "LHD" },
  },
  {
    eventType: "other",
    description: "Seats: 5",
    metadata: { field: "seats", value: "5" },
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
assert(!timeline.some((e) => /steering:/i.test(e.description ?? "")), "steering removed from timeline");
assert(!timeline.some((e) => /^seats:/i.test(e.description ?? "")), "seats removed from timeline");
assert(!timeline.some((e) => e.eventType === "accident"), "accidents removed from timeline");
assert(!timeline.some((e) => e.eventType === "title_status"), "title removed from timeline");
assert(!timeline.some((e) => e.eventType === "sale"), "sale removed from timeline");
assert(!timeline.some((e) => e.eventType === "owner_change"), "owner_change removed from timeline");
assert(timeline.some((e) => e.eventType === "inspection"), "inspection stays in timeline");

console.log("\n=== sortTimelineEvents order ===");
const ordered = filterTimelineEvents([
  {
    eventType: "inspection",
    description: "Recent inspection",
    occurredAt: "2024-11-01",
    metadata: { source: "encar_record" },
  },
  {
    eventType: "delivery",
    description: "First registration: 2019-03-15",
    occurredAt: "2019-03-15",
    metadata: { field: "firstRegistration", value: "2019-03-15", source: "encar" },
  },
  {
    eventType: "inspection",
    description: "Older inspection",
    occurredAt: "2022-01-10",
    metadata: { source: "encar_record" },
  },
]);
assert(ordered[0]?.description?.includes("First registration"), "first registration is first");
assert(ordered[1]?.description === "Recent inspection", "then newest event");
assert(ordered[2]?.description === "Older inspection", "then older event");

assert(
  isExtraSpecEvent({
    eventType: "inspection",
    description: "Autowini inspection report uploaded",
    metadata: { source: "autowini", field: "inspectionReportUploaded" },
  }),
  "autowini inspectionReportUploaded is extra",
);
assert(
  !filterTimelineEvents([
    {
      eventType: "inspection",
      description: "Autowini inspection report uploaded",
      metadata: { source: "autowini", field: "inspectionReportUploaded" },
    },
  ]).some((e) => /autowini inspection report/i.test(e.description ?? "")),
  "autowini inspection flag removed from timeline",
);

console.log("\n=== Encar inspection extras ===");
assert(
  isExtraSpecEvent({
    eventType: "other",
    description: "Inspection vehicle condition: Good",
    metadata: { field: "inspection_condition", value: "Good", source: "encar_inspection" },
  }),
  "inspection_condition is extra",
);
assert(
  !isExtraSpecEvent({
    eventType: "other",
    description: "Inspection record #: 123",
    metadata: { field: "inspection_record_no", value: "123", source: "encar_inspection" },
  }),
  "inspection_record_no is not extra",
);
assert(
  !isExtraSpecEvent({
    eventType: "other",
    description: "Inspection comments: note",
    metadata: { field: "inspection_comments", value: "note", source: "encar_inspection" },
  }),
  "inspection_comments is not extra",
);
assert(
  !isExtraSpecEvent({
    eventType: "other",
    description: "Simple outer-panel repair: Yes",
    metadata: { field: "simple_repair", value: "Yes", source: "encar_inspection" },
  }),
  "simple_repair is not extra",
);
assert(
  !isExtraSpecEvent({
    eventType: "other",
    description: "Hood: Replacement",
    metadata: { field: "inspection_panel_hood", value: "Replacement", source: "encar_inspection" },
  }),
  "legacy inspection_panel_* is not extra",
);

const encarExtra = buildVehicleExtra([
  {
    eventType: "inspection",
    description: "Korean performance inspection — vehicle condition: Good — comments: minor note",
    occurredAt: "2024-06-01",
    metadata: {
      source: "encar_inspection",
      carState: "Good",
      boardState: "None",
      comments: "minor note",
      mileage: 50000,
      recordNo: "ABC",
    },
  },
  {
    eventType: "other",
    description: "Inspection vehicle condition: Good",
    occurredAt: "2024-06-01",
    metadata: { field: "inspection_condition", value: "Good", source: "encar_inspection" },
  },
  {
    eventType: "accident",
    description: "Simple outer-panel repair flagged",
    occurredAt: "2024-06-01",
    metadata: {
      source: "encar_inspection",
      simpleRepair: true,
      condition: "Simple outer-panel repair",
      damage: "Simple outer-panel repair",
    },
  },
  {
    eventType: "other",
    description: "Inspection comments: minor note",
    occurredAt: "2024-06-01",
    metadata: { field: "inspection_comments", value: "minor note", source: "encar_inspection" },
  },
]);
assert(
  Boolean(encarExtra?.some((r) => r.key === "inspection_condition" && r.value === "Good")),
  "inspection_condition row present",
);
assert(
  !encarExtra?.some((r) => r.key === "inspection_comments" || r.key === "simple_repair" || r.key === "condition"),
  "comments / simpleRepair / accident condition stay out of extras",
);
assert(
  (encarExtra?.filter((r) => r.key.startsWith("inspection_")).length ?? 0) === 1,
  "only inspection_condition among inspection_* extras",
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
