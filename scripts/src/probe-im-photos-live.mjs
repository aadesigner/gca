/**
 * Live CDP probe: fetch one Import Motor VIN and print photo host mix + primary.
 *   node --import ./scripts/load-env.mjs ./scripts/src/probe-im-photos-live.mjs [VIN]
 */
import { ImportMotorHistoricalAdapter } from "../../artifacts/api-server/src/lib/providers/import-motor.ts";
import {
  IMPORT_MOTOR_PARSER_VERSION,
  parseImportMotorDetail,
  attachImportMotorSpinPhotos,
} from "../../artifacts/api-server/src/lib/providers/import-motor-parse.ts";
import { resetImportMotorCdpPool } from "../../artifacts/api-server/src/lib/providers/import-motor-cdp.ts";

const vin = (process.argv[2] || "19UDE2F42JA006548").toUpperCase();
const url = `https://import-motor.com/v/${vin}`;

console.log(JSON.stringify({ parser: IMPORT_MOTOR_PARSER_VERSION, vin, url }, null, 2));

resetImportMotorCdpPool();
const adapter = new ImportMotorHistoricalAdapter("https://import-motor.com", {});
const fetched = await adapter.fetchListing(url);
const listing = await attachImportMotorSpinPhotos(
  parseImportMotorDetail(fetched.html ?? "", fetched.url || url),
  fetched.html ?? "",
);
const photos = listing?.photos ?? [];

const byHost = {};
for (const p of photos) {
  let host = "other";
  try {
    host = new URL(p.sourceUrl).host;
  } catch {
    /* ignore */
  }
  byHost[host] = (byHost[host] || 0) + 1;
}

const primary = photos.find((p) => p.isPrimary) || photos[0];
console.log(
  JSON.stringify(
    {
      ok: photos.length >= 8,
      photoCount: photos.length,
      primary: primary?.sourceUrl ?? null,
      byHost,
      sample: photos.slice(0, 8).map((p) => p.sourceUrl),
    },
    null,
    2,
  ),
);

if (photos.length < 8) {
  console.error(`FAIL: expected >=8 photos, got ${photos.length}`);
  process.exit(1);
}
if (/cars2?\.import-motor\.com\/copart\/.+-1(?:-[a-f0-9]+)*\.(?:webp|jpe?g)/i.test(primary?.sourceUrl || "")) {
  console.warn("WARN: primary is still Copart cars2 -1 (often rear)");
}
