const id = process.argv[2] || "IC5494339";
const itemCode = "CI202609130005303570";

const mobileHeaders = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  Accept: "application/json, text/html",
  Origin: "https://m.autowini.com",
  Referer: `https://m.autowini.com/s/item/${id}`,
  "wini-code-select-country": "C1570",
};

async function tryFetch(label, url, headers = mobileHeaders) {
  try {
    const r = await fetch(url, { headers });
    const ct = r.headers.get("content-type") || "";
    const text = await r.text();
    console.log(label, r.status, ct.slice(0, 40), text.slice(0, 300).replace(/\s+/g, " "));
    return { status: r.status, text, ct };
  } catch (e) {
    console.log(label, "ERR", e.message);
    return null;
  }
}

await tryFetch(
  "m detail html",
  `https://m.autowini.com/s/item/${id}`,
  { ...mobileHeaders, Accept: "text/html" },
);

await tryFetch("photos api", `https://v2api.autowini.com/items/${id}/photos`);
await tryFetch("photos api cars", `https://v2api.autowini.com/items/cars/${id}/photos`);

for (const path of [
  `/items/${id}/photo-list`,
  `/items/${id}/images/list`,
  `/car/${itemCode}/photos`,
  `/items/${itemCode}/photos`,
  `/upload/${itemCode}/photos`,
]) {
  await tryFetch(path, `https://v2api.autowini.com${path}`);
}

// desktop cars-detail
await tryFetch(
  "cars-detail",
  `https://www.autowini.com/Cars/Used-2009-BMW-Z4-${id}/cars-detail`,
  {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
    Accept: "text/html,application/xhtml+xml",
    Referer: "https://www.autowini.com/",
  },
);

// probe if there's index-based listing in folder - unlikely with UUIDs
// try item detail on m with json accept
await tryFetch("m item json", `https://m.autowini.com/api/items/${id}`, {
  ...mobileHeaders,
  Accept: "application/json",
});
