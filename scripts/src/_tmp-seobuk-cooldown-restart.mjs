const PROD = process.env.PROD_API_URL || "https://getcarapi.com";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
async function login() {
  const res = await fetch(`${PROD}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status} ${await res.text()}`);
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}
async function api(cookie, method, path, body) {
  const res = await fetch(`${PROD}${path}`, {
    method,
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0,400) }; }
  return { status: res.status, json };
}
const cookie = await login();
console.log("pause327", await api(cookie, "POST", "/api/admin/jobs/327/pause"));
console.log("stopBF", await api(cookie, "POST", "/api/admin/seobuk/photos/backfill/stop"));
console.log("waiting 120s for seobuk unblock...");
await new Promise(r => setTimeout(r, 120000));
console.log("startBF", await api(cookie, "POST", "/api/admin/seobuk/photos/backfill", { limit: 400, delayMs: 3500, minPhotos: 8 }));
await new Promise(r => setTimeout(r, 25000));
console.log("status", await api(cookie, "GET", "/api/admin/seobuk/photos/backfill"));
