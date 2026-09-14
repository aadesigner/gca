const url =
  process.argv[2] ||
  "https://thebidrive.com/en/listing/72197a6f-d266-4d17-acb0-4ec94c8666b2/2017-honda-accord-jhmcr6650hc200324";
const html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
const cut = html.search(/Similar/i);
const main = cut > 0 ? html.slice(0, cut) : html;
console.log(
  JSON.stringify(
    {
      ldBlocks: [...html.matchAll(/application\/ld\+json/gi)].length,
      hasNextData: html.includes("__NEXT_DATA__"),
      og:
        html.match(/property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] ??
        html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1],
      allCatalog: [...new Set([...html.matchAll(/\/catalog\/(IC\d+)\//gi)].map((m) => m[1]))],
      mainCatalog: [...new Set([...main.matchAll(/\/catalog\/(IC\d+)\//gi)].map((m) => m[1]))],
      allEncar: [...new Set([...html.matchAll(/cdn\.thebidrive\.com\/encar\/(\d+)\//gi)].map((m) => m[1]))],
      mainEncar: [...new Set([...main.matchAll(/cdn\.thebidrive\.com\/encar\/(\d+)\//gi)].map((m) => m[1]))],
      jsonSnippets: [...html.matchAll(/IC\d{7}/g)].slice(0, 20).map((m) => m[0]),
    },
    null,
    2,
  ),
);
