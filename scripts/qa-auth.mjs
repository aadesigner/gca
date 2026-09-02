/**
 * Client auth QA — register, session cookie, login, deployed asset version.
 * Run: node --import ./scripts/load-env.mjs ./scripts/qa-auth.mjs
 */
const BASE = (process.env.QA_BASE_URL || "https://getcarapi.com").replace(/\/$/, "");

function pass(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
  return ok;
}

function captureCookies(jar, res) {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const raw of setCookies) {
    const pair = raw.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  if (!setCookies.length) {
    const legacy = res.headers.get("set-cookie");
    if (legacy) {
      const pair = legacy.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }
}

function cookieHeader(jar) {
  if (!jar.size) return {};
  return { Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ") };
}

(async () => {
  console.log(`Auth QA → ${BASE}\n`);
  let ok = true;
  const ts = Date.now();
  const email = `qa-auth-${ts}@example.com`;
  const jar = new Map();

  const cfgRes = await fetch(`${BASE}/api/client/auth/captcha-config`);
  const cfg = await cfgRes.json();
  ok = pass("captcha-config", cfgRes.status === 200, JSON.stringify(cfg)) && ok;

  const reg = await fetch(`${BASE}/api/client/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Id": "qa-auth",
      Origin: BASE,
    },
    body: JSON.stringify({
      email,
      password: "SecurePass99!",
      confirmPassword: "SecurePass99!",
    }),
  });
  captureCookies(jar, reg);
  const regBody = await reg.json();
  ok =
    pass(
      "register",
      reg.status === 201 && Boolean(regBody.id),
      `status=${reg.status} cookie=${[...jar.keys()].join(",") || "none"} err=${regBody.error ?? ""}`,
    ) && ok;

  const me1 = await fetch(`${BASE}/api/client/auth/me`, { headers: cookieHeader(jar) });
  ok = pass("me after register", me1.status === 200, String(me1.status)) && ok;

  const dash1 = await fetch(`${BASE}/api/client/dashboard`, { headers: cookieHeader(jar) });
  ok = pass("dashboard after register", dash1.status === 200, String(dash1.status)) && ok;

  await fetch(`${BASE}/api/client/auth/logout`, { method: "POST", headers: cookieHeader(jar) });
  jar.clear();

  const login = await fetch(`${BASE}/api/client/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Id": "qa-auth",
      Origin: BASE,
    },
    body: JSON.stringify({ email, password: "SecurePass99!" }),
  });
  captureCookies(jar, login);
  const loginBody = await login.json();
  ok =
    pass(
      "login",
      login.status === 200,
      `status=${login.status} cookie=${[...jar.keys()].join(",") || "none"} err=${loginBody.error ?? ""}`,
    ) && ok;

  const me2 = await fetch(`${BASE}/api/client/auth/me`, { headers: cookieHeader(jar) });
  ok = pass("me after login", me2.status === 200, String(me2.status)) && ok;

  const html = await fetch(`${BASE}/account/`).then((r) => r.text());
  const assetMatch = html.match(/account\.js\?v=([^"']+)/);
  ok = pass("account.js cache bust", Boolean(assetMatch), assetMatch?.[1] ?? "missing");

  const accountJs = await fetch(`${BASE}/assets/account.js?v=${assetMatch?.[1] ?? "x"}`).then((r) => r.text());
  ok = pass("account.js has openClientDashboardAfterAuth", accountJs.includes("openClientDashboardAfterAuth")) && ok;
  ok = pass("account.js has probeClientAuth", accountJs.includes("probeClientAuth")) && ok;
  ok = pass("account.js no finishing sign-in loop", !accountJs.includes("finishing sign-in")) && ok;

  console.log(`\n${ok ? "ALL PASSED" : "SOME FAILED"}`);
  if (!ok) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
