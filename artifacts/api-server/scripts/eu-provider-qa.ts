/**
 * QA: discover → fetch → parse for each new EU provider (+ bidscan).
 * Run from repo root:
 *   node --experimental-strip-types artifacts/api-server/scripts/eu-provider-qa.ts
 */
import { AaaautoHistoricalAdapter } from "../src/lib/providers/aaaauto.ts";
import {
  Autoscout24EsHistoricalAdapter,
  Autoscout24BeHistoricalAdapter,
  AutotradernlHistoricalAdapter,
} from "../src/lib/providers/autoscout24.ts";
import { SautoHistoricalAdapter } from "../src/lib/providers/sauto.ts";
import { AutomobileitHistoricalAdapter } from "../src/lib/providers/automobileit.ts";
import { SubitoHistoricalAdapter } from "../src/lib/providers/subito.ts";
import { StandvirtualHistoricalAdapter } from "../src/lib/providers/standvirtual.ts";
import { MobilebgHistoricalAdapter } from "../src/lib/providers/mobilebg.ts";
import { BidscanHistoricalAdapter } from "../src/lib/providers/bidscan.ts";

const BAD_PHOTO =
  /logo|favicon|sprite|icon-|flag|apple-pay|google-pay|placeholder|avatar|banner|adservice|doubleclick|tracking/i;

const adapters = [
  new AaaautoHistoricalAdapter(),
  new Autoscout24EsHistoricalAdapter(),
  new Autoscout24BeHistoricalAdapter(),
  new AutotradernlHistoricalAdapter(),
  new SautoHistoricalAdapter(),
  new AutomobileitHistoricalAdapter(),
  new SubitoHistoricalAdapter(),
  new StandvirtualHistoricalAdapter(),
  new MobilebgHistoricalAdapter(),
  new BidscanHistoricalAdapter(),
] as const;

function vinOk(vin?: string) {
  return !!vin && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);
}

async function headOk(url: string) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*,*/*;q=0.8" },
    });
    clearTimeout(t);
    const type = res.headers.get("content-type") ?? "";
    return {
      ok: res.status >= 200 && res.status < 400 && /image\//i.test(type),
      type,
      status: res.status,
    };
  } catch {
    return { ok: false };
  }
}

const results: Record<string, unknown>[] = [];

for (const adapter of adapters) {
  const name = (adapter as { internalName: string }).internalName;
  const row: Record<string, unknown> = { provider: name, ok: false };
  try {
    const discovered = await adapter.discoverListings(1);
    row.discovered = discovered.listings.length;
    if (!discovered.listings.length) {
      row.error = "no listings on page 1";
      results.push(row);
      console.log(JSON.stringify(row));
      continue;
    }

    let listing: Awaited<ReturnType<typeof adapter.parseListing>> | undefined;
    let used = discovered.listings[0]!;
    for (const cand of discovered.listings.slice(0, 6)) {
      const fetched = await adapter.fetchListing(cand.url);
      const parsed = await adapter.parseListing(fetched);
      used = cand;
      listing = parsed;
      if (vinOk(parsed.vehicle?.vin)) break;
    }

    row.url = used.url;
    row.sourceId = used.sourceId;
    row.vin = listing?.vehicle?.vin ?? null;
    row.vinOk = vinOk(listing?.vehicle?.vin);
    row.title = listing?.title?.slice(0, 90) ?? null;
    row.make = listing?.vehicle?.make ?? null;
    row.model = listing?.vehicle?.model ?? null;
    row.year = listing?.vehicle?.year ?? null;
    row.price = listing?.priceAmount ?? null;
    row.currency = listing?.priceCurrency ?? null;
    row.mileage = listing?.mileage ?? null;
    row.status = listing?.listingStatus ?? null;
    row.country = listing?.country ?? null;
    row.photoCount = listing?.photos?.length ?? 0;
    row.targetProvider = (listing as { targetProvider?: string } | undefined)?.targetProvider ?? null;

    const photos = listing?.photos ?? [];
    row.badPhotoUrls = photos.filter((p) => BAD_PHOTO.test(p.sourceUrl || "")).length;
    row.samplePhotos = photos.slice(0, 3).map((p) => p.sourceUrl);

    const heads = [];
    for (const p of photos.slice(0, 2)) {
      heads.push({ url: (p.sourceUrl || "").slice(0, 100), ...(await headOk(p.sourceUrl)) });
    }
    row.photoHeads = heads;

    const issues: string[] = [];
    if (!row.title && !row.make) issues.push("no title/make");
    if (row.vinOk && row.photoCount === 0) issues.push("VIN present but 0 photos");
    if ((row.badPhotoUrls as number) > 0) issues.push("suspicious photo urls");
    if (heads.length > 0 && heads.every((h) => !h.ok)) issues.push("photo HEAD failed");
    if (!row.vinOk && row.photoCount === 0) {
      row.note = "no public VIN — photos intentionally gated on VIN in these adapters";
    }

    row.issues = issues;
    row.ok = issues.length === 0;
  } catch (err) {
    row.error = err instanceof Error ? err.message : String(err);
  }
  results.push(row);
  console.log(JSON.stringify(row));
}

const failed = results.filter((r) => !r.ok);
console.log("\n=== SUMMARY ===");
console.log(
  JSON.stringify(
    {
      total: results.length,
      ok: results.filter((r) => r.ok).length,
      failed: failed.map((r) => r.provider),
      withVin: results.filter((r) => r.vinOk).length,
      withPhotos: results.filter((r) => Number(r.photoCount ?? 0) > 0).length,
    },
    null,
    2,
  ),
);
process.exit(failed.length ? 1 : 0);
