/**
 * Login to production admin and start / poll Seobuk photo backfill.
 */
const PROD = process.env.PROD_API_URL || "https://getcarapi.com";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error("ADMIN_EMAIL / ADMIN_PASSWORD required");

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
    signal: AbortSignal.timeout(60_000),
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

const mode = process.argv[2] || "status";
const cookie = await login();

if (mode === "start") {
  const started = await api(cookie, "POST", "/api/admin/seobuk/photos/backfill", {
    limit: 400,
    delayMs: 1200,
    minPhotos: 8,
  });
  console.log("start", started.status, JSON.stringify(started.json));
} else if (mode === "stop") {
  const stopped = await api(cookie, "POST", "/api/admin/seobuk/photos/backfill/stop");
  console.log("stop", stopped.status, JSON.stringify(stopped.json));
} else if (mode === "mirror") {
  const started = await api(cookie, "POST", "/api/admin/photos/mirror-backfill/start");
  console.log("mirror", started.status, JSON.stringify(started.json));
} else {
  const status = await api(cookie, "GET", "/api/admin/seobuk/photos/backfill");
  console.log("status", status.status, JSON.stringify(status.json));
}
