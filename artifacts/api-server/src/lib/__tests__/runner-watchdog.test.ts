/**
 * Smoke: runner-watchdog module loads and exports expected API.
 *   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/__tests__/runner-watchdog.test.ts
 */
import assert from "node:assert/strict";
import {
  isRunnerWatchdogEnabled,
  getLastRunnerWatchdogReport,
} from "../runner-watchdog.ts";

assert.equal(typeof isRunnerWatchdogEnabled(), "boolean");
assert.equal(getLastRunnerWatchdogReport(), null);
console.log("runner-watchdog tests ok");
