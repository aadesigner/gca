/**
 * One-shot production ops: crawl health, photo mirror, dashboard stats.
 * Usage: node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-status.mjs [--start-mirror]
 */
const PROD = process.env.PROD_API_URL || "https://getcarapi.com";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const startMirror = process.argv.includes("--start-mirror");

if (!email || !password) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD required");

async function login() {
  const res = await fetch(`${PROD}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${PROD}${path}`, {
    method,
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

const cookie = await login();
console.log("Logged in to prod admin\n");

const dash = await api(cookie, "GET", "/api/admin/dashboard/stats");
console.log("Dashboard stats:", JSON.stringify(dash.json, null, 2));

const jobs = await api(cookie, "GET", "/api/admin/collection-jobs?limit=50");
const running = (jobs.json?.jobs ?? jobs.json?.data ?? []).filter((j) => j.status === "running");
console.log(`\nRunning crawls (${running.length}):`);
for (const j of running) {
  console.log(`  #${j.id} ${j.provider?.internalName ?? j.providerInternalName ?? "?"} processed=${j.processedCount ?? j.processed ?? "?"}`);
}

const crawlHealth = await api(cookie, "GET", "/api/admin/crawl-health");
console.log("\nCrawl health (cached):", JSON.stringify(crawlHealth.json?.report ?? crawlHealth.json, null, 2)?.slice(0, 2000));

const mirror = await api(cookie, "GET", "/api/admin/photos/mirror-backfill/status");
console.log("\nPhoto mirror backfill:", JSON.stringify(mirror.json, null, 2));

if (startMirror) {
  const start = await api(cookie, "POST", "/api/admin/photos/mirror-backfill/start");
  console.log("\nStart mirror backfill:", start.status, JSON.stringify(start.json));
  await new Promise((r) => setTimeout(r, 5000));
  const mirror2 = await api(cookie, "GET", "/api/admin/photos/mirror-backfill/status");
  console.log("Mirror after 5s:", JSON.stringify(mirror2.json, null, 2));
}
