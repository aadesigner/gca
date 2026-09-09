/**
 * Live QA: BidExport filter → asPhotos must keep distinct IAAI imageKeys.
 *   node --experimental-strip-types ./scripts/src/_qa-bidexport-photos.mjs
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
register(
  "data:text/javascript," +
    encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\\.[a-zA-Z0-9]+$/.test(specifier.split('?')[0])) {
      try { return await nextResolve(specifier + '.ts', context); } catch {}
    }
    return nextResolve(specifier, context);
  }
`),
  pathToFileURL("./"),
);

const { asPhotos, isJunkPhotoUrl } = await import(
  pathToFileURL(resolve(root, "artifacts/api-server/src/lib/providers/web-html.ts")).href
);

const res = await fetch(
  "https://bidexport.com/filter?limit=8&skip=0&sort=" + encodeURIComponent(JSON.stringify({ Year: -1 })),
  {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Origin: "https://bidexport.com",
      Referer: "https://bidexport.com/online-auto-auction-search/filter",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({ SalvageType: "AUTOMOBILE", Images: true }),
  },
);

if (!res.ok) throw new Error(`filter HTTP ${res.status}`);
const json = await res.json();
const items = Array.isArray(json?.data) ? json.data : [];
console.log("filter count", json?.count, "page", items.length);

function mapValues(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  if (typeof obj !== "object") return [];
  return Object.keys(obj)
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    .map((k) => obj[k]);
}

function photoUrls(item) {
  const buckets = [item.ImageURL, item.images, item.ImageURLThumbNail];
  const out = [];
  for (const b of buckets) {
    for (const v of mapValues(b)) {
      if (typeof v === "string" && /^https?:\/\//i.test(v)) out.push(v);
    }
  }
  return [...new Set(out)];
}

function photoUrlsOldBug(item) {
  // Old: images ?? ImageURL — empty [] wins and drops ImageURL
  const fromImages = mapValues(item.images ?? item.ImageURL ?? item.ImageURLThumbNail).filter(
    (v) => typeof v === "string" && /^https?:\/\//i.test(v),
  );
  return [...new Set(fromImages)];
}

let ok = 0;
let bad = 0;
for (const item of items.slice(0, 8)) {
  const raw = photoUrls(item);
  const photos = asPhotos(raw);
  const stripped = asPhotos(raw.map((u) => u.split("?")[0]));
  const stock = item.StockNumber ?? item.stockNumber ?? item.Id ?? "?";
  const hasIaai = raw.some((u) => /vis\.iaai\.com/i.test(u));
  const row = {
    stock,
    rawN: raw.length,
    photoN: photos.length,
    strippedWouldKeep: stripped.length,
    hasIaai,
    keepKeys: photos.filter((p) => /imageKeys=/i.test(p.sourceUrl)).length,
    sample: (photos[0]?.sourceUrl || raw[0] || "").slice(0, 100),
  };
  console.log(row);
  if (hasIaai && photos.length < 2) {
    console.error("FAIL: IAAI lot with <2 photos", stock);
    bad++;
  } else if (photos.length === 0 && raw.length > 0) {
    console.error("FAIL: raw urls but asPhotos empty", stock);
    bad++;
  } else if (photos.length === 0) {
    console.warn("SKIP/empty gallery (pipeline would not crawl)", stock);
  } else {
    ok++;
  }
  if (Array.isArray(item.images) && item.images.length === 0 && item.ImageURL) {
    const oldN = photoUrlsOldBug(item).length;
    const newN = raw.length;
    if (oldN === 0 && newN > 0) console.log("  fixed empty-images[] short-circuit for", stock);
  }
}

console.log({ ok, bad, itemCount: items.length });
if (bad) process.exit(1);
