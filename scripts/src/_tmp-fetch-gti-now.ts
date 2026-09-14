import { ImportMotorHistoricalAdapter } from "../../artifacts/api-server/src/lib/providers/import-motor.ts";

const a = new ImportMotorHistoricalAdapter();
const fetched = await a.fetchListing("https://import-motor.com/v/WVWED71K98W309297");
console.log({ htmlLen: fetched?.html?.length, url: fetched?.finalUrl || fetched?.url });
const parsed = await a.parseListing(fetched);
console.log({
  sourceId: parsed.sourceId,
  vin: parsed.vehicle?.vin,
  title: (parsed.title || "").slice(0, 100),
  n: parsed.photos?.length ?? 0,
  sample: (parsed.photos ?? []).slice(0, 5).map((p) => p.sourceUrl.slice(0, 130)),
});
