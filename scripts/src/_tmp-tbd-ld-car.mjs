const url =
  process.argv[2] ||
  "https://thebidrive.com/en/listing/72197a6f-d266-4d17-acb0-4ec94c8666b2/2017-honda-accord-jhmcr6650hc200324";
const html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
for (const block of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
  try {
    const parsed = JSON.parse(block[1]);
    const nodes = Array.isArray(parsed) ? parsed : [parsed, ...((parsed["@graph"] ?? []))];
    for (const n of nodes) {
      if (String(n?.["@type"] ?? "").match(/^(Car|Vehicle|Product)$/i) || n?.vehicleIdentificationNumber) {
        console.log(JSON.stringify(n, null, 2));
      }
    }
  } catch {
    /* ignore */
  }
}
