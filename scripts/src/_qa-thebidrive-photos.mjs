/**
 * Live QA: TheBidrive detail gallery must not include Similar-lot CDN folders.
 *   node --experimental-strip-types ./scripts/src/_qa-thebidrive-photos.mjs [url]
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

const { galleryUrls } = await import(
  pathToFileURL(resolve(root, "artifacts/api-server/src/lib/providers/thebidrive.ts")).href
);
const { asPhotos } = await import(
  pathToFileURL(resolve(root, "artifacts/api-server/src/lib/providers/web-html.ts")).href
);

const seedUrl =
  process.argv[2] ||
  "https://thebidrive.com/en/auctions";

async function findDetailUrl() {
  if (/\/(auctions|cars)\//i.test(seedUrl) && !/\/(auctions|cars)\/?$/i.test(seedUrl)) {
    return seedUrl;
  }
  const res = await fetch(seedUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
  });
  const html = await res.text();
  const m = html.match(/https?:\/\/(?:www\.)?thebidrive\.com\/en\/(?:auctions|cars)\/[a-z0-9/_-]+/i);
  if (!m) throw new Error("no detail link on " + seedUrl);
  return m[0];
}

const detail = await findDetailUrl();
console.log("detail", detail);
const res = await fetch(detail, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "text/html",
  },
});
const html = await res.text();
let ld;
const ldMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
if (ldMatch) {
  try {
    const parsed = JSON.parse(ldMatch[1]);
    ld = Array.isArray(parsed) ? parsed.find((x) => x?.["@type"] === "Car" || x?.image) : parsed;
  } catch {
    /* ignore */
  }
}

const urls = galleryUrls(html, ld);
const photos = asPhotos(urls);
const folders = new Set();
for (const u of urls) {
  const ic = u.match(/\/catalog\/(IC\d+)\//i)?.[1];
  if (ic) folders.add("ic:" + ic.toUpperCase());
  const bd = u.match(/cdn\.thebidrive\.com\/(encar|copart|iaa|iaai|carpages)\/(\d{4,})\//i);
  if (bd) folders.add(`bd:${bd[1]}:${bd[2]}`);
}
console.log({
  urlN: urls.length,
  photoN: photos.length,
  folders: [...folders],
  sample: urls.slice(0, 3),
});

if (photos.length === 0) {
  console.error("FAIL: no usable photos (pipeline would skip — ok if listing truly has none)");
  process.exit(1);
}
if (folders.size > 1) {
  console.error("FAIL: multiple gallery folders (Similar leak)", [...folders]);
  process.exit(1);
}
console.log("thebidrive live gallery: ok");
