/**
 * Re-crawl thin JapaneseCarTrade galleries (1 CDN primary → full gabs/mycarguru album).
 * Requires Chrome CDP (JCT_CDP_URL or IMPORT_MOTOR_CDP_URL=http://127.0.0.1:9222).
 *
 *   pnpm backfill:jct-photos --dry-run --limit 20
 *   pnpm backfill:jct-photos --limit 100 --delay 1200
 */
await import("../load-env.mjs");

const { backfillJctPhotos, parseJctBackfillArgs } = await import(
  "../../artifacts/api-server/src/lib/collector/backfill-jct-photos.ts"
);

const opts = parseJctBackfillArgs(process.argv.slice(2));

console.log(
  opts.dryRun
    ? "Dry run — listing JCT rows with thin galleries…"
    : "Re-crawling thin JapaneseCarTrade galleries via CDP…",
);
if (opts.vin) console.log("  VIN filter:", opts.vin);
if (opts.listingId != null) console.log("  Listing filter:", opts.listingId);
console.log(
  "  Limit:",
  opts.limit,
  "| Delay:",
  opts.delayMs,
  "ms | Min photos:",
  opts.minPhotos ?? 2,
  "| Since days:",
  opts.sinceDays ?? 0,
);

const stats = await backfillJctPhotos(opts);
console.log("Done.", stats);

process.exit(!opts.dryRun && stats.errors > 0 && stats.repaired === 0 ? 1 : 0);
