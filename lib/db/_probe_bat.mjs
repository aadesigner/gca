const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

async function probe(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  const t = await r.text();
  const s = new Set();
  for (const m of t.matchAll(/bringatrailer\.com\/listing\/([a-z0-9-]+)/g)) s.add(m[1]);
  const next =
    t.match(/rel="next"[^>]*href="([^"]+)"/)?.[1] ||
    t.match(/href="([^"]+)"[^>]*>\s*Next/i)?.[1] ||
    t.match(/auctions\/results\/[^"]*page[^"]*/)?.[0];
  const pagerHints = [...t.matchAll(/page[=/](\d+)/gi)].slice(0, 8).map((m) => m[0]);
  console.log({
    url,
    status: r.status,
    unique: s.size,
    sample: [...s].slice(0, 2),
    next,
    pagerHints,
    hasLoadMore: /load more|infinite|data-page/i.test(t),
  });
  return { t, s };
}

const urls = [
  "https://bringatrailer.com/auctions/results/",
  "https://bringatrailer.com/auctions/results/?results_page=2",
  "https://bringatrailer.com/auctions/results/page/2/",
  "https://bringatrailer.com/auctions/results/?paged=2",
  "https://bringatrailer.com/auctions/results/?offset=45",
  "https://bringatrailer.com/auctions/?status=results&page=2",
];

for (const u of urls) {
  try {
    await probe(u);
  } catch (e) {
    console.log("ERR", u, e.message);
  }
}

// Look for API endpoints in page 1 HTML
const { t } = await probe("https://bringatrailer.com/auctions/results/");
const apis = [...t.matchAll(/https?:\/\/[^"' ]*(?:api|wp-json|ajax|graphql)[^"' ]*/gi)].slice(0, 20);
console.log("API-ish", apis.map((m) => m[0]));
const dataAttrs = [...t.matchAll(/data-[a-z-]+=\"[^\"]{0,80}\"/gi)]
  .map((m) => m[0])
  .filter((x) => /page|offset|url|ajax|load/i.test(x))
  .slice(0, 30);
console.log("data", dataAttrs);
