/**
 * Run: pnpm tsx src/lib/__tests__/mileage-history.test.ts
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
