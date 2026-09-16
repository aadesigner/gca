/** Test whether carstat.info allows plain Node fetch (no CDP). */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function tryFetch(url) {
  const r = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  const text = await r.text();
  return {
    url,
    status: r.status,
    final: r.url,
    len: text.length,
    title: (text.match(/<title[^>]*>([^<]*)/i) || [])[1] || "",
    cf: /just a moment|cf-browser-verification|cloudflare/i.test(text.slice(0, 5000)),
    hasLots: text.includes('"lots":['),
    hasVin: /WDD1J6GB7HF026959/.test(text),
    lotLinks: (text.match(/\/lot\/[a-f0-9-]{36}/gi) || []).length,
  };
}

for (const url of [
  "https://carstat.info/catalog",
  "https://carstat.info/catalog/page/2",
  "https://carstat.info/lot/5e019dd3-92b0-4c5b-b496-01fb01aa78f5/mercedes-benz/WDD1J6GB7HF026959",
]) {
  console.log(JSON.stringify(await tryFetch(url), null, 2));
}
