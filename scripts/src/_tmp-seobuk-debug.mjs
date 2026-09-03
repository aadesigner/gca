const PROD = process.env.PROD_API_URL || "https://getcarapi.com";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

const res = await fetch(`${PROD}/api/admin/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!res.ok) throw new Error(`login ${res.status}`);
const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

const sourceId = process.argv[2] || "C6EE310DB77E790F0A7716C9CD800D98";
const debug = await fetch(`${PROD}/api/admin/seobuk/debug-photos/${sourceId}`, {
  headers: { Cookie: cookie },
  signal: AbortSignal.timeout(60_000),
});
const text = await debug.text();
console.log(debug.status, text.slice(0, 6000));
