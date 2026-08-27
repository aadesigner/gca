/**
 * Repair Cars24.ae listings from stored raw HTML (price/make/model/photos).
 * Run: pnpm --filter @workspace/scripts run backfill-cars24ae
 */
import pg from "pg";
import { backfillCars24FromRaw } from "../../artifacts/api-server/src/lib/collector/backfill-cars24ae.ts";

await import("../load-env.mjs");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
console.log("Backfilling Cars24.ae from raw HTML…");
const stats = await backfillCars24FromRaw(pool);
console.log("Done.", stats);
await pool.end();
