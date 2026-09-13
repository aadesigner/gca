/**
 * Re-crawl recent Import Motor listings with thin galleries.
 * Run: pnpm backfill:import-motor-photos [--dry-run] [--limit N] [--since-days N] [--vin VIN]
 */
await import("../load-env.mjs");

const { backfillImportMotorPhotos, parseImportMotorBackfillArgs } = await import(
  "../../artifacts/api-server/src/lib/collector/backfill-import-motor-photos.ts"
);

const opts = parseImportMotorBackfillArgs(process.argv.slice(2));

console.log(
  opts.dryRun
    ? "Dry run — listing Import Motor rows with thin galleries (no HTTP/DB writes)…"
    : "Re-crawling recent Import Motor listings with thin galleries…",
);
if (opts.vin) console.log("  VIN filter:", opts.vin);
if (opts.listingId != null) console.log("  Listing filter:", opts.listingId);
if (opts.all) console.log("  Mode: all listings");
console.log(
  "  Limit:",
  opts.limit,
  "| Delay:",
  opts.delayMs,
  "ms | Min photos:",
  opts.minPhotos ?? 10,
  "| Since days:",
  opts.sinceDays ?? 21,
);

const stats = await backfillImportMotorPhotos(opts);
console.log("Done.", stats);

process.exit(!opts.dryRun && stats.errors > 0 && stats.repaired === 0 ? 1 : 0);
