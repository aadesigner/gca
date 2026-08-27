/**
 * Restore Encar ask prices that the old dummy-price filter dropped.
 * Run: pnpm backfill:encar-prices
 */
import pg from "pg";
import { backfillEncarPricesFromRaw } from "../../artifacts/api-server/src/lib/collector/backfill-encar-prices.ts";

await import("../load-env.mjs");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

console.log("Backfilling Encar listing/observation prices from stored raw JSON…");
const stats = await backfillEncarPricesFromRaw(pool);
console.log(
  `Scanned ${stats.scanned}; priced ${stats.listingsPriced} listings and ${stats.observationsPriced} observations; marked ${stats.soldMarked} sold/inactive.`,
);
await pool.end();
