/**
 * Run with: pnpm tsx src/lib/__tests__/fx-krw.test.ts
 */
import { shouldAttachKrw } from "../geo";

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

console.log("\n=== shouldAttachKrw ===");
assert(shouldAttachKrw("South Korea", "KRW") === true, "Korean car in KRW");
assert(shouldAttachKrw("KR", "USD") === false, "Korean car in USD does not invent priceKrw");
assert(shouldAttachKrw("United Arab Emirates", "AED") === false, "Dubai car does not get KRW");
assert(shouldAttachKrw("United States", "USD") === false, "US car does not get KRW");
assert(shouldAttachKrw("Canada", "CAD") === false, "Canadian car does not get KRW");
assert(shouldAttachKrw("United States", "KRW") === true, "native KRW listing still attaches KRW");
assert(shouldAttachKrw("South Korea", null) === false, "Korean car without currency does not invent KRW");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
