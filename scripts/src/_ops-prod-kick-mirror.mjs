/**
 * Kick production photo mirror backfill via admin API.
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

async function api(cookie, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${text.slice(0, 300)}`);
  return json;
}

const cookie = await login();
const before = await api(cookie, "GET", "/api/admin/photos/mirror-status");
console.log("before", JSON.stringify(before, null, 2));
const started = await api(cookie, "POST", "/api/admin/photos/mirror-backfill/start");
console.log("started", JSON.stringify(started, null, 2));
await new Promise((r) => setTimeout(r, 8000));
const after = await api(cookie, "GET", "/api/admin/photos/mirror-status");
console.log("after", JSON.stringify(after, null, 2));
