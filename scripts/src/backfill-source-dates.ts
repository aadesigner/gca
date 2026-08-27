/**
 * Backfill site publish / last-updated dates onto listings + observations.
 * Run: pnpm --filter @workspace/scripts run backfill-source-dates
 */
import pg from "pg";
import { backfillSourceDatesFromRaw } from "../../artifacts/api-server/src/lib/collector/backfill-source-dates.ts";

await import("../load-env.mjs");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

console.log("Backfilling source publish/update dates from raw JSON + id patterns…");
const stats = await backfillSourceDatesFromRaw(pool);
console.log("Done.", stats);
await pool.end();
