/**
 * Run: pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/__tests__/sauto-year.test.ts
 */
import { resolveSautoYearAndDates } from "../providers/sauto";

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

console.log("\n=== Sauto year: STK pasted into in_operation_date ===");
{
  const r = resolveSautoYearAndDates({
    in_operation_date: "2028-02-01",
    manufacturing_date: "2008-01-01",
    stk_date: "2028-02-01",
    name: "Audi A4 Avant, Audi a4 2.0 TDi quattro s-line",
  });
  assert(r.year === 2008, "uses manufacturing_date 2008, not STK 2028");
  assert(r.firstRegRaw === "2008-01-01", "first reg falls back to manufacturing");
  assert(r.stkRaw === "2028-02-01", "stk date preserved for inspection event");
}

console.log("\n=== Sauto year: sane in_operation ===");
{
  const r = resolveSautoYearAndDates({
    in_operation_date: "2015-06-01",
    manufacturing_date: "2015-01-01",
    stk_date: "2027-06-01",
    name: "Skoda Octavia",
  });
  assert(r.year === 2015, "manufacturing preferred when present");
  assert(r.firstRegRaw === "2015-06-01", "sane in_operation used for first reg");
}

console.log("\n=== Sauto year: manufacturing only ===");
{
  const r = resolveSautoYearAndDates({
    manufacturing_date: "2019-03-01",
    name: "BMW 320d",
  });
  assert(r.year === 2019, "manufacturing alone works");
  assert(r.firstRegRaw === "2019-03-01", "first reg from manufacturing");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
