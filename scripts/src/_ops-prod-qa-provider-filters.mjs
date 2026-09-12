/**
 * QA admin provider filters on production for every enabled provider.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-qa-provider-filters.mjs
 */
const API = process.env.PROD_API_URL || "https://getcarapi.com";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error("ADMIN_EMAIL/ADMIN_PASSWORD required");

async function login() {
  const res = await fetch(`${API}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function api(cookie, path, ms = 120_000) {
  const started = Date.now();
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Cookie: cookie, Accept: "application/json" },
      signal: AbortSignal.timeout(ms),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 400) };
    }
    return { status: res.status, ms: Date.now() - started, json, text: text.slice(0, 400) };
  } catch (err) {
    return {
      status: 0,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const cookie = await login();
const providers = await api(cookie, "/api/admin/providers?limit=100");
const list = providers.json?.providers ?? providers.json?.data ?? providers.json ?? [];
const rows = Array.isArray(list) ? list : [];
const enabled = rows
  .filter((p) => p.enabled !== false)
  .map((p) => ({
    id: p.id,
    name: p.internalName ?? p.internal_name ?? p.name,
  }))
  .filter((p) => p.id != null && p.name);

console.log("providers", enabled.length);

const results = [];
for (const p of enabled) {
  const vehicles = await api(cookie, `/api/admin/vehicles?providerId=${p.id}&limit=20&page=1`);
  const stats = await api(cookie, `/api/admin/vehicles/stats?providerId=${p.id}`);
  const listings = await api(cookie, `/api/admin/listings?providerId=${p.id}&limit=20&page=1`);
  const vCount =
    vehicles.json?.total ??
    vehicles.json?.pagination?.total ??
    vehicles.json?.vehicles?.length ??
    null;
  const lCount =
    listings.json?.total ??
    listings.json?.pagination?.total ??
    listings.json?.listings?.length ??
    null;
  const row = {
    provider: p.name,
    id: p.id,
    vehicles: {
      status: vehicles.status,
      ms: vehicles.ms,
      total: vCount,
      error: vehicles.error || (vehicles.status >= 400 ? vehicles.text : undefined),
    },
    stats: {
      status: stats.status,
      ms: stats.ms,
      total: stats.json?.totalVehicles ?? stats.json?.total ?? null,
      error: stats.error || (stats.status >= 400 ? stats.text : undefined),
    },
    listings: {
      status: listings.status,
      ms: listings.ms,
      total: lCount,
      error: listings.error || (listings.status >= 400 ? listings.text : undefined),
    },
  };
  results.push(row);
  const bad =
    row.vehicles.status !== 200 ||
    row.stats.status !== 200 ||
    row.listings.status !== 200 ||
    row.vehicles.error ||
    row.stats.error ||
    row.listings.error;
  console.log(
    (bad ? "FAIL" : "ok  ").padEnd(5),
    String(p.name).padEnd(22),
    `v=${row.vehicles.status}/${row.vehicles.ms}ms`,
    `s=${row.stats.status}/${row.stats.ms}ms`,
    `l=${row.listings.status}/${row.listings.ms}ms`,
    bad ? JSON.stringify(row).slice(0, 200) : "",
  );
}

const fails = results.filter(
  (r) =>
    r.vehicles.status !== 200 ||
    r.stats.status !== 200 ||
    r.listings.status !== 200 ||
    r.vehicles.error ||
    r.stats.error ||
    r.listings.error,
);
console.log(JSON.stringify({ failCount: fails.length, fails, sampleImportMotor: results.find((r) => r.provider === "import_motor") }, null, 2));
