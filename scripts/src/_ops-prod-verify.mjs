/**
 * Post-sync verification: missing VIN gap, CDN photos sample, crawl fleet.
 */
import pg from "pg";

const PROD = process.env.PROD_API_URL || "https://getcarapi.com";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

async function login() {
  const res = await fetch(`${PROD}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${PROD}${path}`, {
    method,
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

const cookie = await login();

const dash = await api(cookie, "GET", "/api/admin/dashboard/stats");
console.log("Prod vehicles:", dash.json?.totalVins, "photosSelfHosted:", dash.json?.photosSelfHostedCount);

const mirror = await api(cookie, "GET", "/api/admin/photos/mirror-status");
console.log("Mirror:", JSON.stringify(mirror.json));

const jobs = await api(cookie, "GET", "/api/admin/jobs?limit=80");
const list = jobs.json?.items ?? jobs.json?.data ?? jobs.json?.jobs ?? (Array.isArray(jobs.json) ? jobs.json : []);
const running = list.filter((j) => j.status === "running");
const pending = list.filter((j) => j.status === "pending");
console.log(`Jobs: running=${running.length} pending=${pending.length}`);
for (const j of running.slice(0, 12)) {
  console.log(`  RUN #${j.id} ${j.provider?.internalName ?? j.providerInternalName} pages=${j.pagesProcessed} listings=${j.listingsFetched ?? j.itemsProcessed}`);
}

console.log("\nTriggering crawl-health run (may take up to 2 min)…");
const ch = await api(cookie, "POST", "/api/admin/crawl-health/run");
console.log("Crawl-health:", ch.status, JSON.stringify(ch.json)?.slice(0, 2500));

// Spot-check CDN on a recent synced photo via SQL if prod PG available
if (process.env.PROD_PG_PASSWORD) {
  const prod = new pg.Client({
    host: process.env.PROD_PG_HOST ?? "yamanote.proxy.rlwy.net",
    port: Number(process.env.PROD_PG_PORT ?? "15622"),
    user: "postgres",
    password: process.env.PROD_PG_PASSWORD,
    database: "railway",
    ssl: false,
    connectionTimeoutMillis: 15_000,
  });
  try {
    await prod.connect();
    const gap = await prod.query(`
      SELECT count(*)::int AS missing
      FROM vehicles lv
      WHERE lv.created_at > now() - interval '7 days'
        AND NOT EXISTS (SELECT 1 FROM vehicles pv WHERE pv.vin = lv.vin)
    `).catch(() => null);
    if (gap) console.log("\nNote: gap query needs local DB — skipped");
    const recent = await prod.query(`
      SELECT count(*)::int AS photos,
        count(*) FILTER (WHERE stored_path ~* 'imgsv\\.getcarapi\\.com')::int AS cdn,
        count(*) FILTER (WHERE stored_path IS NULL)::int AS pending
      FROM photos
      WHERE created_at > now() - interval '2 hours'
    `);
    console.log("\nProd photos last 2h:", recent.rows[0]);
    await prod.end();
  } catch (e) {
    console.log("\nProd PG spot-check skipped:", e.message);
  }
}
