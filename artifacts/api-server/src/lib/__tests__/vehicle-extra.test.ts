/**
 * Run with: pnpm tsx src/lib/__tests__/vehicle-extra.test.ts
 */
import {
  appendMileageReadingsToTimeline,
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
  isExtraSpecEvent({
    eventType: "other",
    description: "Interior Colour: Black",
    metadata: { field: "interior_colour", value: "Black", source: "carpages" },
  }),
  "interior_colour metadata is extra",
);
assert(
  isExtraSpecEvent({
    eventType: "other",
    description: "Passengers: 5",
    metadata: { field: "passengers", value: "5", source: "carpages" },
  }),
  "passengers metadata is extra",
);
assert(
  !filterTimelineEvents([
    {
      eventType: "other",
      description: "Interior Colour: Black",
      metadata: { field: "interior_colour", value: "Black", source: "carpages" },
    },
    {
      eventType: "other",
      description: "Passengers: 5",
      metadata: { field: "passengers", value: "5", source: "carpages" },
    },
    {
      eventType: "owner_change",
      description: "Owner change",
      metadata: { source: "encar_record" },
    },
  ]).some((e) => /interior|passengers/i.test(e.description ?? "")),
  "interior colour and passengers removed from timeline",
);
{
  const extra = buildVehicleExtra([
    {
      eventType: "other",
      description: "Interior Colour: Black",
      metadata: { field: "interior_colour", value: "Black", source: "carpages" },
    },
    {
      eventType: "other",
      description: "Passengers: 5",
      metadata: { field: "passengers", value: "5", source: "carpages" },
    },
  ]);
  assert(!!extra?.some((r) => r.key === "interior_color" && r.value === "Black"), "extra has interior color");
  assert(!!extra?.some((r) => r.key === "passengers" && r.value === "5"), "extra has passengers");
}
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
assert(timeline.some((e) => e.eventType === "owner_change"), "owner_change stays in timeline");
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
assert(ordered[0]?.description === "Recent inspection", "newest event first");
assert(ordered[1]?.description === "Older inspection", "then older event");
assert(ordered[2]?.description?.includes("First registration"), "first registration by date, not pinned");

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

console.log("\n=== collapse same-date inspection fragments ===");
const collapsedInspection = filterTimelineEvents([
  {
    eventType: "inspection",
    description:
      "Korean performance inspection — record #300 — issued 2026-09-08 — 12,000 km — vehicle condition: Good",
    occurredAt: "2026-09-08",
    metadata: {
      source: "encar_inspection",
      recordNo: "300",
      mileageKm: 12000,
      carState: "Good",
      issueDate: "2026-09-08",
    },
  },
  {
    eventType: "other",
    description: "Inspection valid from: 2025-10-14",
    occurredAt: "2026-09-08",
    metadata: {
      source: "encar_inspection",
      field: "inspection_valid_from",
      value: "2025-10-14",
      date: "2026-09-08",
    },
  },
  {
    eventType: "other",
    description: "Inspection valid until: 2030-10-13",
    occurredAt: "2026-09-08",
    metadata: {
      source: "encar_inspection",
      field: "inspection_valid_to",
      value: "2030-10-13",
      date: "2026-09-08",
    },
  },
  {
    eventType: "other",
    description: "Inspection comments: FRP panel was repaired.",
    occurredAt: "2026-09-08",
    metadata: {
      source: "encar_inspection",
      field: "inspection_comments",
      value: "FRP panel was repaired.",
      date: "2026-09-08",
    },
  },
  {
    eventType: "inspection",
    description: "Inspection findings — Hood: Replacement",
    occurredAt: "2026-09-08",
    metadata: {
      source: "encar_inspection_panels",
      panels: [{ key: "hood", label: "Hood", result: "Replacement" }],
      date: "2026-09-08",
    },
  },
  {
    eventType: "other",
    description: "Manufacturer recall outstanding on performance inspection (2026-09-08) — Not completed",
    occurredAt: "2026-09-08",
    metadata: { source: "encar_inspection", field: "recall", kind: "recall" },
  },
]);
assert(
  collapsedInspection.filter((e) => /korean performance inspection/i.test(e.description ?? "")).length === 1,
  "one inspection summary for the day",
);
assert(
  !collapsedInspection.some((e) => /^Inspection valid from:/i.test(e.description ?? "")),
  "valid-from fragment removed",
);
assert(
  !collapsedInspection.some((e) => /^Inspection valid until:/i.test(e.description ?? "")),
  "valid-until fragment removed",
);
assert(
  !collapsedInspection.some((e) => /^Inspection comments:/i.test(e.description ?? "")),
  "comments fragment removed",
);
assert(
  !collapsedInspection.some((e) => /^Inspection findings/i.test(e.description ?? "")),
  "panel findings folded into summary",
);
const merged = collapsedInspection.find((e) => /korean performance inspection/i.test(e.description ?? ""));
assert(Boolean(merged?.description?.includes("valid 2025-10-14 → 2030-10-13")), "validity folded into summary");
assert(Boolean(merged?.description?.includes("comments: FRP panel was repaired.")), "comments folded into summary");
assert(Boolean(merged?.description?.includes("findings:")), "findings folded into summary");
assert(
  collapsedInspection.some((e) => /manufacturer recall/i.test(e.description ?? "")),
  "recall stays as its own event",
);

console.log("\n=== owner_change + mileage on timeline ===");
const ownerTimeline = filterTimelineEvents([
  {
    eventType: "owner_change",
    description: "Ownership",
    occurredAt: "2023-05-30",
    metadata: { mileageKm: 45148 },
  },
  {
    eventType: "owner_change",
    description: "Owner change",
    occurredAt: "2023-05-30",
    metadata: {},
  },
  {
    eventType: "owner_change",
    description: "Transaction of trading business",
    occurredAt: "2023-05-30",
    metadata: {},
  },
  {
    eventType: "inspection",
    description: "Korean performance inspection — 12,000 km",
    occurredAt: "2024-01-01",
    metadata: { source: "encar_inspection", mileageKm: 12000, date: "2024-01-01" },
  },
]);
assert(
  ownerTimeline.filter((e) => e.eventType === "owner_change").length === 1,
  "same-day owner labels collapse to one",
);
assert(
  /45,148\s*km/i.test(ownerTimeline.find((e) => e.eventType === "owner_change")?.description ?? ""),
  "collapsed owner event includes mileage",
);

const withListingMileage = appendMileageReadingsToTimeline(ownerTimeline, [
  {
    date: "2025-06-17",
    mileageKm: 99766,
    kind: "listing",
    source: "Autowini",
  },
  {
    date: "2024-01-01",
    mileageKm: 12000,
    kind: "inspection",
    source: "encar_inspection",
  },
]);
assert(
  withListingMileage.some((e) => /listing odometer/i.test(e.description ?? "") && /99,766/i.test(e.description ?? "")),
  "listing mileage appears on timeline",
);
assert(
  withListingMileage.filter((e) => /12,000/i.test(e.description ?? "")).length === 1,
  "inspection mileage already on timeline is not duplicated",
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
