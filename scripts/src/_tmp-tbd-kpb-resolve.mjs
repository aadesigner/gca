import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mod = await import(
  pathToFileURL(path.join(ROOT, "artifacts/api-server/src/lib/providers/thebidrive.ts")).href
);
const url =
  "https://thebidrive.com/en/listing/b84418cc-7c42-4da3-ba17-0a65793cc40d/2023-kg-mobility-ssangyong-torres-kpbph3at1pp024362";
const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
const html = await r.text();
console.log("meta", mod.parseEmbeddedBidriveListing(html));
const gallery = await mod.resolveThebidriveGallery(
  html,
  undefined,
  "listing/b84418cc-7c42-4da3-ba17-0a65793cc40d/x",
);
console.log("gallery_count", gallery.length);
console.log(gallery.slice(0, 12));
