const url =
  process.argv[2] ||
  "https://thebidrive.com/en/listing/72197a6f-d266-4d17-acb0-4ec94c8666b2/2017-honda-accord-jhmcr6650hc200324";
const html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
const uuid = url.match(/([a-f0-9-]{36})/i)?.[1];
const vin = url.match(/([A-HJ-NPR-Z0-9]{17})/i)?.[1];
for (const needle of [uuid, vin, "IC5265489", "catalogId", "catalog_id", "imageCatalog"]) {
  const idx = html.indexOf(needle ?? "");
  if (idx >= 0) {
    console.log("\n---", needle, "at", idx, "---");
    console.log(html.slice(Math.max(0, idx - 120), idx + 200).replace(/\s+/g, " "));
  }
}
for (const block of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
  try {
    const parsed = JSON.parse(block[1]);
    console.log("\nLD type:", parsed["@type"] || parsed["@graph"]?.[0]?.["@type"], JSON.stringify(parsed).slice(0, 300));
  } catch {
    /* ignore */
  }
}
