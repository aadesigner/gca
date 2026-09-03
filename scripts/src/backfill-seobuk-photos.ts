/**
 * Re-crawl Seobuk listings with thin or junk galleries.
 * Run: pnpm backfill:seobuk-photos [--dry-run] [--all] [--limit N] [--delay MS] [--vin VIN]
 */
await import("../load-env.mjs");

const { backfillSeobukPhotos, parseSeobukBackfillArgs } = await import(
  "../../artifacts/api-server/src/lib/collector/backfill-seobuk-photos.ts"
);

const opts = parseSeobukBackfillArgs(process.argv.slice(2));

console.log(
  opts.dryRun
    ? "Dry run — listing Seobuk rows with thin/junk galleries (no HTTP/DB writes)…"
    : "Re-crawling Seobuk listings with thin/junk galleries…",
);
if (opts.vin) console.log("  VIN filter:", opts.vin);
if (opts.listingId != null) console.log("  Listing filter:", opts.listingId);
if (opts.all) console.log("  Mode: all listings");
console.log("  Limit:", opts.limit, "| Delay:", opts.delayMs, "ms | Min photos:", opts.minPhotos ?? 8);
if (!process.env.KR_PROXY && !process.env.ENCAR_PROXY) {
  console.warn(
    "  Warning: KR_PROXY / ENCAR_PROXY not set — Seobuk may return 403 from this IP. Prefer running the backfill on the API host.",
  );
}

const stats = await backfillSeobukPhotos(opts);
console.log("Done.", stats);

process.exit(!opts.dryRun && stats.errors > 0 && stats.repaired === 0 && stats.photosPurged === 0 ? 1 : 0);
