import fs from "node:fs";

const ids = ["476506249", "476506345", "476506378"];

for (const id of ids) {
  const url = `https://www.finn.no/mobility/item/${id}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "Accept-Language": "en,nb;q=0.9",
    },
  });
  const html = await res.text();
  fs.writeFileSync(`${process.env.TEMP}/finn-${id}.html`, html);

  const normalized = html.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  const re =
    /https?:\/\/images\.finncdn\.no\/dynamic\/([^/"'\s]+)\/item\/(\d+)\/([a-f0-9-]{20,})/gi;
  const matches = [...normalized.matchAll(re)];
  const uuids = new Set(matches.map((m) => m[3]));
  console.log("\n", id, "status", res.status, "html", html.length);
  console.log("collectFinnPhotosMatches", matches.length, "unique", uuids.size);
  console.log(
    "samples",
    matches.slice(0, 5).map((m) => m[0].slice(0, 120)),
  );

  // Other image hosts?
  const other = [
    ...normalized.matchAll(
      /https?:\/\/[a-z0-9.-]+\.(?:finncdn|cloudfront|imgix|akamai)[^"'\s)]+/gi,
    ),
  ].slice(0, 10);
  console.log(
    "otherHosts",
    other.map((m) => m[0].slice(0, 140)),
  );

  const og =
    normalized.match(/property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] ??
    normalized.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
  console.log("og:image", og?.slice(0, 160));
}
