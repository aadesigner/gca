/**
 * Run: pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/__tests__/insurance-gap-format.test.ts
 */
import {
  formatInsuranceGapPeriod,
  formatInsuranceCoverageGapDescription,
  translateEncarEventDescription,
} from "../providers/encar-locale";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

console.log("\n=== insurance gap formatting ===");
assert(formatInsuranceGapPeriod("202007~202010") === "2020-07 to 2020-10", "YYYYMM~YYYYMM");
assert(formatInsuranceGapPeriod("202007 to 202010") === "2020-07 to 2020-10", "YYYYMM to YYYYMM");
assert(formatInsuranceGapPeriod("20200115~20200320") === "2020-01-15 to 2020-03-20", "YYYYMMDD range");
assert(
  formatInsuranceCoverageGapDescription("Insurance coverage gap: 202007 to 202010") ===
    "Insurance coverage gap: 2020-07 to 2020-10",
  "full description",
);
assert(
  translateEncarEventDescription("Insurance coverage gap: 202007~202010") ===
    "Insurance coverage gap: 2020-07 to 2020-10",
  "via translateEncarEventDescription",
);

console.log(failed === 0 ? "\nOK" : `\n${failed} failed`);
if (failed) process.exit(1);
