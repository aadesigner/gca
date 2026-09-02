/**
 * Re-crawl Seobuk listings that have junk photo URLs (logos/icons from old parser).
 * Run: pnpm backfill:seobuk-photos [--dry-run] [--limit N] [--delay MS] [--vin VIN]
 */
await import("../load-env.mjs");

const { backfillSeobukPhotos, parseSeobukBackfillArgs } = await import(
  "../../artifacts/api-server/src/lib/collector/backfill-seobuk-photos.ts"
);

const opts = parseSeobukBackfillArgs(process.argv.slice(2));

console.log(
  opts.dryRun
    ? "Dry run — listing Seobuk rows with junk photos (no HTTP/DB writes)…"
    : "Re-crawling Seobuk listings with junk photos…",
);
if (opts.vin) console.log("  VIN filter:", opts.vin);
if (opts.listingId != null) console.log("  Listing filter:", opts.listingId);
console.log("  Limit:", opts.limit, "| Delay:", opts.delayMs, "ms");
if (!process.env.KR_PROXY && !process.env.ENCAR_PROXY) {
  console.warn(
    "  Warning: KR_PROXY / ENCAR_PROXY not set — Seobuk may return 403; junk rows will still be purged on fetch failure.",
  );
}

const stats = await backfillSeobukPhotos(opts);
console.log("Done.", stats);

process.exit(
  !opts.dryRun && stats.errors > 0 && stats.repaired === 0 && stats.photosPurged === 0 ? 1 : 0,
);
