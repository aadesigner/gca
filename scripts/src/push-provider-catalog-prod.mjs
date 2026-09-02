/**
 * Export a provider catalog from local admin API and import to production.
 * Usage: node --import ./scripts/load-env.mjs ./scripts/src/push-provider-catalog-prod.mjs encar
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const provider = process.argv[2]?.trim();
if (!provider) {
  console.error("Usage: push-provider-catalog-prod.mjs <provider_internal_name>");
  process.exit(1);
}

const LOCAL = process.env.LOCAL_API_URL || "http://127.0.0.1:5000";
const PROD = process.env.PROD_API_URL || "https://getcarapi.com";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD required");

async function login(base) {
  const res = await fetch(`${base}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${base} ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "scripts", ".sync-tmp");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `catalog-${provider}-${Date.now()}.json`);

console.log(`Export ${provider} from ${LOCAL} → ${outFile}`);
const localCookie = await login(LOCAL);
const exportRes = await fetch(`${LOCAL}/api/admin/vins/export?format=json&provider=${encodeURIComponent(provider)}`, {
  headers: { Cookie: localCookie },
});
if (!exportRes.ok) {
  console.error("export failed", exportRes.status, await exportRes.text().then((t) => t.slice(0, 300)));
  process.exit(1);
}

const body = await exportRes.text();
fs.writeFileSync(outFile, body, "utf8");
const catalog = JSON.parse(body);
const count = catalog.listings?.length ?? 0;
console.log(`Exported ${count} listings (${(body.length / 1024 / 1024).toFixed(2)} MB)`);

console.log(`Import to ${PROD}…`);
process.env.API_BASE_URL = PROD;
const batchSize = Number(process.env.SYNC_IMPORT_BATCH || 40);
const prodCookie = await login(PROD);
const listings = catalog.listings || [];
const totals = { batches: 0, listingsUpserted: 0, photosAdded: 0, errors: [] };

for (let i = 0; i < listings.length; i += batchSize) {
  const chunk = listings.slice(i, i + batchSize);
  const res = await fetch(`${PROD}/api/admin/vins/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: prodCookie },
    body: JSON.stringify({
      format: "getcarapi-vin-catalog",
      version: 1,
      exportedAt: catalog.exportedAt || new Date().toISOString(),
      listings: chunk,
    }),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { error: text.slice(0, 200) };
  }
  if (!res.ok) {
    console.error("batch failed at", i, res.status, parsed);
    totals.errors.push(String(parsed.error || res.status));
    break;
  }
  totals.batches++;
  totals.listingsUpserted += Number(parsed.listingsUpserted || 0);
  totals.photosAdded += Number(parsed.photosAdded || 0);
  if ((i / batchSize) % 25 === 0 || i + chunk.length >= listings.length) {
    console.log(`  ${Math.min(i + chunk.length, listings.length)}/${listings.length} — upserted ${totals.listingsUpserted}, photos +${totals.photosAdded}`);
  }
}

console.log("Done:", totals);
if (process.env.SYNC_KEEP_EXPORT !== "1") {
  try {
    fs.unlinkSync(outFile);
  } catch {
    /* ignore */
  }
}
