/**
 * Run: pnpm --filter @workspace/api-server exec tsx src/lib/__tests__/mileage-history.test.ts
 */
import { buildMileageHistory } from "../mileage-history";

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

console.log("\n=== listing mileage plateau thinning ===");
const rows = buildMileageHistory({
  observations: [
    { mileage: 23162, mileageUnit: "km", observedAt: "2026-09-07", providerName: "thebidrive" },
    { mileage: 23162, mileageUnit: "km", observedAt: "2026-08-30", providerName: "encar" },
    { mileage: 23162, mileageUnit: "km", observedAt: "2026-08-29", providerName: "encar" },
    { mileage: 23155, mileageUnit: "km", observedAt: "2026-06-29", providerName: "encar" },
  ],
  events: [
    {
      eventType: "inspection",
      description: "Korean performance inspection — 23,155 km",
      occurredAt: "2024-11-29",
      metadata: { source: "encar_inspection", mileageKm: 23155, date: "2024-11-29" },
    },
  ],
});

const listing23162 = rows.filter((r) => r.mileageKm === 23162 && r.kind === "listing");
assert(listing23162.length === 2, "flat 23162 listing plateau keeps first + last only");
assert(listing23162[0]?.date === "2026-08-29", "keeps earliest plateau date");
assert(listing23162[1]?.date === "2026-09-07", "keeps latest plateau date");
assert(rows.some((r) => r.mileageKm === 23155), "distinct km readings remain");

console.log("\n=== never stamp inspection km with firstRegistrationDate ===");
const buggy = buildMileageHistory({
  events: [
    {
      eventType: "inspection",
      description: "Performance inspection record — 161,207 km",
      occurredAt: "2015-01-16", // wrongly stored as first-reg in older crawls
      metadata: {
        source: "encar_inspection",
        mileageKm: 161207,
        firstRegistrationDate: "20150116",
        validityStartDate: "20250729",
        validityEndDate: "20270728",
      },
    },
  ],
  observations: [
    {
      mileage: 161215,
      mileageUnit: "km",
      sourceUpdatedAt: "2026-08-19",
      providerName: "encar",
    },
  ],
});
const inspectionRow = buggy.find((r) => r.kind === "inspection" && r.mileageKm === 161207);
assert(!!inspectionRow, "inspection reading present");
assert(inspectionRow?.date === "2025-07-29", "uses validityStartDate, not 2015 first registration");
assert(!buggy.some((r) => r.mileageKm === 161207 && r.date.startsWith("2015")), "no 2015 stamp on 161k km");

console.log("\n=== drop undated inspection when only first-reg is known ===");
const noValid = buildMileageHistory({
  events: [
    {
      eventType: "inspection",
      description: "Performance inspection — 100,000 km",
      occurredAt: "2015-01-16",
      metadata: {
        source: "encar_inspection",
        mileageKm: 100000,
        firstRegistrationDate: "2015-01-16",
      },
    },
  ],
});
assert(
  !noValid.some((r) => r.mileageKm === 100000),
  "omits km reading when the only candidate date is first registration",
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
