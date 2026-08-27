/**
 * Import a getcarapi-vin-catalog JSON via admin API in batches.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/import-vin-catalog-file.mjs <catalog.json> [batchSize]
 */
import fs from "node:fs";

const API = process.env.API_BASE_URL || "http://127.0.0.1:5000";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in the environment");
}
const file = process.argv[2];
const batchSize = Math.max(1, Number(process.argv[3] || 40));

if (!file) {
  console.error("Usage: import-vin-catalog-file.mjs <catalog.json> [batchSize]");
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
const listings = catalog.listings || catalog;
if (!Array.isArray(listings)) throw new Error("No listings array");

const login = await fetch(`${API}/api/admin/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) {
  console.error("login failed", login.status, await login.text());
  process.exit(1);
}
const setCookies = login.headers.getSetCookie?.() || [];
let cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
if (!cookie) {
  const sc = login.headers.get("set-cookie") || "";
  cookie = sc
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

const totals = {
  batches: 0,
  listingsRead: 0,
  vehiclesUpserted: 0,
  listingsUpserted: 0,
  photosAdded: 0,
  observationsAdded: 0,
  eventsAdded: 0,
  skippedNoVin: 0,
  providersCreated: [],
  errors: [],
};

for (let i = 0; i < listings.length; i += batchSize) {
  const chunk = listings.slice(i, i + batchSize);
  const res = await fetch(`${API}/api/admin/vins/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      format: "getcarapi-vin-catalog",
      version: 1,
      exportedAt: catalog.exportedAt || new Date().toISOString(),
      listings: chunk,
    }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 300) };
  }
  if (!res.ok) {
    console.error("batch failed", i, res.status, body);
    totals.errors.push(`batch@${i}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
    break;
  }
  totals.batches++;
  for (const k of [
    "listingsRead",
    "vehiclesUpserted",
    "listingsUpserted",
    "photosAdded",
    "observationsAdded",
    "eventsAdded",
    "skippedNoVin",
  ]) {
    totals[k] += Number(body[k] || 0);
  }
  if (Array.isArray(body.providersCreated)) {
    totals.providersCreated.push(...body.providersCreated);
  }
  if (Array.isArray(body.errors) && body.errors.length) {
    totals.errors.push(...body.errors.slice(0, 20));
  }
  console.log(
    JSON.stringify({
      at: i + chunk.length,
      of: listings.length,
      photosAdded: body.photosAdded,
      listingsUpserted: body.listingsUpserted,
      errN: (body.errors || []).length,
    }),
  );
}

totals.providersCreated = [...new Set(totals.providersCreated)];
totals.errorCount = totals.errors.length;
totals.errors = totals.errors.slice(0, 30);
console.log(JSON.stringify(totals, null, 2));
