const urls = process.argv.slice(2);
for (const url of urls) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const html = await res.text();
  const cdn = [...new Set([...html.matchAll(/https:\/\/cdn\.thebidrive\.com\/[^"'\\\s>]+/gi)].map((m) => m[0]))];
  const og =
    html.match(/property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] ??
    html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
  let ldCount = 0;
  for (const block of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(block[1]);
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...((parsed["@graph"] ?? []))];
      for (const n of nodes) {
        if (!n?.image) continue;
        ldCount += Array.isArray(n.image) ? n.image.length : 1;
      }
    } catch {
      /* ignore */
    }
  }
  console.log(JSON.stringify({ url, status: res.status, ldCount, og, cdnCount: cdn.length, cdnSample: cdn.slice(0, 8) }, null, 2));
}
