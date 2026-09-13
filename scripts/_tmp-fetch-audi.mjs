await import("./scripts/load-env.mjs");
const { ImportMotorHistoricalAdapter } = await import(
  "./artifacts/api-server/src/lib/providers/import-motor.ts"
);

const a = new ImportMotorHistoricalAdapter();
const url = "https://import-motor.com/v/WA1EAAFY7P2014783";
const fetched = await a.fetchListing(url);
const parsed = await a.parseListing(fetched);
const photos = parsed.photos || [];
console.log("count", photos.length, "sourceId", parsed.sourceId);
for (const p of photos) console.log(p.sortOrder, p.group ?? "gallery", String(p.sourceUrl).slice(0, 150));

const h = fetched.html || "";
const cars = [...new Set([...h.matchAll(/https?:\/\/cars2?\.import-motor\.com\/[^"'\\\s<>]+/gi)].map((m) => m[0]))];
const cs = [...new Set([...h.matchAll(/https?:\/\/cs\.copart\.com\/[^"'\\\s<>]+/gi)].map((m) => m[0]))];
console.log("html cars", cars.length, "html cs", cs.length);
cs.forEach((u, i) => console.log("cs", i, u.slice(0, 140)));

// fotorama img count
const imgs = [...h.matchAll(/<img[^>]+alt=["']WA1EAAFY7P2014783["'][^>]*>/gi)];
console.log("vin-alt imgs", imgs.length);
