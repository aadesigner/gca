/**
 * Live HTTP QA for BeForward / Syarah / JapaneseUsedCars — no adapter imports.
 * Validates discover + detail shape, VIN, ordered photos.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function ok(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log("  OK", msg);
}

async function get(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9,ar;q=0.5" },
    redirect: "follow",
    signal: AbortSignal.timeout(40000),
  });
  return { status: r.status, url: r.url, text: await r.text() };
}

function bfPhotos(html, stockId) {
  const sizeRank = { original: 4, large: 3, medium: 2, small: 1 };
  const byFile = new Map();
  let order = 0;
  const re = new RegExp(
    `(?:https?:)?\\/\\/image-cdn\\.beforward\\.jp\\/(original|large|medium|small)\\/(\\d+)\\/${stockId}\\/([^"'?\\s>]+)`,
    "gi",
  );
  for (const m of html.matchAll(re)) {
    const size = m[1].toLowerCase();
    const key = m[3].toLowerCase();
    const rank = sizeRank[size] ?? 0;
    const url = `https://image-cdn.beforward.jp/${size}/${m[2]}/${stockId}/${m[3]}`;
    const prev = byFile.get(key);
    if (!prev) byFile.set(key, { url, rank, order: order++ });
    else if (rank > prev.rank) byFile.set(key, { url, rank, order: prev.order });
  }
  return [...byFile.values()].sort((a, b) => a.order - b.order).map((x) => x.url);
}

async function qaBeforward() {
  console.log("\n=== BE FORWARD ===");
  const list = await get("https://www.beforward.jp/stocklist/make=1/");
  const links = [
    ...new Set(
      [...list.text.matchAll(/href="(\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/id\/(\d+)\/)"/gi)].map((m) => [
        m[1],
        m[2],
      ]),
    ),
  ].slice(0, 3);
  // Set of pairs unique by id
  const seen = new Set();
  const samples = [];
  for (const m of list.text.matchAll(/href="(\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/id\/(\d+)\/)"/gi)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    samples.push({ path: m[1], id: m[2] });
    if (samples.length >= 3) break;
  }
  ok(samples.length >= 3, `list has ≥3 stock links (${samples.length})`);

  let vinOk = 0;
  let photoOk = 0;
  for (const s of samples) {
    const d = await get(`https://www.beforward.jp${s.path}`);
    const chassis =
      d.text.match(/Chassis No\.?\s*<\/[^>]+>\s*<[^>]+>([^<]+)/i)?.[1]?.trim() ??
      d.text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/)?.[1] ??
      d.text.match(/\b([A-Z0-9]{3,}-?\d{5,})\b/)?.[1];
    const photos = bfPhotos(d.text, s.id);
    const km = d.text.match(/([\d,]+)\s*km/i)?.[1];
    const price = d.text.match(/"price"\s*:\s*"(\d+)"/i)?.[1];
    console.log({ id: s.id, chassis, km, price, photos: photos.length, first: photos[0]?.slice(-40) });
    if (chassis && !/\*/.test(chassis)) vinOk++;
    if (photos.length >= 2) photoOk++;
    ok(photos.every((u) => u.includes(`/${s.id}/`)), `${s.id} photos scoped`);
    ok(photos[0]?.includes("/original/") || photos[0]?.includes("/large/"), `${s.id} prefers original/large`);
  }
  ok(vinOk >= 1, `full chassis/VIN on ≥1/3 samples (${vinOk}) — ~45% site-wide yield expected`);
  ok(photoOk >= 2, `≥2 photos on ≥2/3 samples (${photoOk})`);
}

async function qaSyarah() {
  console.log("\n=== SYARAH ===");
  const list = await get("https://syarah.com/en/autos");
  const fpd = JSON.parse(list.text.match(/window\.FULL_PAGE_DATA\s*=\s*(\{[\s\S]*?\});/)[1]);
  ok(Array.isArray(fpd.posts) && fpd.posts.length >= 5, `list posts=${fpd.posts.length}`);
  const post = fpd.posts[0];
  const url = post.product_url.startsWith("http") ? post.product_url : `https://syarah.com${post.product_url}`;
  const d = await get(url);
  const detail = JSON.parse(d.text.match(/window\.FULL_PAGE_DATA\s*=\s*(\{[\s\S]*?\});/)[1]);
  const pd = detail.postDetails;
  const images = pd.gallery?.images ?? [];
  const vins = [...new Set(JSON.stringify(detail).match(/[A-HJ-NPR-Z0-9]{17}/g) || [])].filter(
    (v) => /[A-Z]/.test(v) && /\d/.test(v) && !/^0+$/.test(v),
  );
  console.log({
    id: pd.details?.id,
    make: pd.details?.details_card?.make?.name,
    model: pd.details?.details_card?.model?.name,
    year: pd.g4Data?.post_year,
    km: pd.g4Data?.post_mileage,
    price: pd.g4Data?.post_price,
    gallery: images.length,
    featuredFirst: images[0]?.is_featured,
    vins,
  });
  ok(pd.details?.details_card?.make?.name, "make");
  ok(pd.g4Data?.post_mileage > 0, "mileage");
  ok(pd.g4Data?.post_price > 0, "price");
  ok(images.length >= 5, `gallery ≥5 (${images.length})`);
  ok(images[0]?.is_featured === 1, "featured image first");
  console.log("  note: public VIN omitted — provider enabled=false");
}

async function qaJuc() {
  console.log("\n=== JAPANESE USED CARS ===");
  const list = await get("https://japaneseusedcars.com/japan-domestic-dealer-cars-at-a-fixed-price/");
  const ids = [...new Set([...list.text.matchAll(/\/vehicle\/([A-Z0-9]+)/gi)].map((m) => m[1]))];
  ok(ids.length >= 3, `vehicle links=${ids.length}`);
  const d = await get(`https://japaneseusedcars.com/vehicle/${ids[0]}/`);
  const chassis = d.text.match(/Chassis[\s\S]{0,80}?([A-HJ-NPR-Z0-9*]{8,20})/i)?.[1];
  const make = d.text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").trim();
  console.log({ id: ids[0], chassis, make: make?.slice(0, 40) });
  ok(make, "title/make present");
  ok(/\*/.test(chassis || "") || !chassis, "chassis masked or absent (expected)");
  console.log("  note: masked chassis — provider enabled=false");
}

await qaBeforward();
await qaSyarah();
await qaJuc();
console.log("\nLive QA passed.");
