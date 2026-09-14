/**
 * Smoke-test Seobuk / Finn / Carpool / KAA discover without writing DB.
 * Fail closed if CF challenge / empty / hard errors.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function probe(name, url, check) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
    });
    const text = await res.text();
    const cf = /Just a moment|cf-challenge|challenge-platform|Attention Required/i.test(text);
    const ok = res.ok && !cf && check(text, res);
    console.log(
      JSON.stringify({
        name,
        status: res.status,
        cf,
        ok,
        len: text.length,
        snippet: text.slice(0, 120).replace(/\s+/g, " "),
      }),
    );
    return ok;
  } catch (e) {
    console.log(JSON.stringify({ name, ok: false, error: e.message }));
    return false;
  }
}

const results = {};
results.kaa = await probe(
  "koreaauto_auction",
  "https://koreaauto.auction/wp-json/wp/v2/vehicle?per_page=5&page=1",
  (t) => {
    try {
      const j = JSON.parse(t);
      return Array.isArray(j) && j.length > 0;
    } catch {
      return false;
    }
  },
);

results.finn = await probe(
  "finn",
  "https://www.finn.no/mobility/search/car?page=1",
  (t) => t.length > 5000 && !/Just a moment/i.test(t),
);

results.carpool = await probe(
  "carpoolkr",
  "https://www.carpoolkr.com/car/",
  (t) => t.length > 2000 && (/vin|차대|IC\d+|href/i.test(t) || t.includes("carpool")),
);

results.seobuk = await probe(
  "seobuk",
  "https://www.seobuk.org/",
  (t) => t.length > 1000 && !/blocked|Access Denied/i.test(t),
);

console.log("SUMMARY", results);
