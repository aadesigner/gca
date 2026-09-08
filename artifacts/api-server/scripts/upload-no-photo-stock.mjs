/**
 * Upload stock image using api-server R2 helpers.
 * Run from repo root:
 *   node --import ./scripts/load-env.mjs ./artifacts/api-server/scripts/upload-no-photo-stock.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadR2Config, r2PutObject, r2PublicUrl } from "../src/lib/r2.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const png = path.join(root, "artifacts/site/public/assets/no-photo-found.png");
const svg = path.join(root, "artifacts/site/public/assets/no-photo-found.svg");

if (!loadR2Config()) {
  console.error("R2 not configured");
  process.exit(1);
}

if (fs.existsSync(png)) {
  const key = "stock/no-photo-found.png";
  await r2PutObject({ key, body: fs.readFileSync(png), contentType: "image/png" });
  console.log("png", r2PublicUrl(key));
}
if (fs.existsSync(svg)) {
  const key = "stock/no-photo-found.svg";
  await r2PutObject({ key, body: fs.readFileSync(svg), contentType: "image/svg+xml" });
  console.log("svg", r2PublicUrl(key));
}
