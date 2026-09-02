/**
 * Client auth QA — register, session cookie, login, enter redirect, deployed assets.
 * Run: node --import ./scripts/load-env.mjs ./scripts/qa-auth.mjs
 * Removes the QA account it creates when DATABASE_URL is set (see qa-cleanup-accounts.mjs).
 *
 * Note: this validates API + Set-Cookie headers. Browser cookie timing is covered by enterClientArea + /enter.
 */
const BASE = (process.env.QA_BASE_URL || "https://getcarapi.com").replace(/\/$/, "");
const QA_EMAIL = `qa-auth-${Date.now()}@example.com`;

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
  const email = QA_EMAIL;
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
  const regCookies = reg.headers.getSetCookie?.() ?? [];
  ok =
    pass(
      "register",
      reg.status === 201 && Boolean(regBody.id) && Boolean(regBody.authenticated),
      `status=${reg.status} cookie=${[...jar.keys()].join(",") || "none"} err=${regBody.error ?? ""}`,
    ) && ok;
  ok =
    pass(
      "register Set-Cookie host-only",
      regCookies.length > 0 && !String(regCookies[0]).includes("Domain="),
      regCookies[0]?.slice(0, 80) ?? "missing",
    ) && ok;

  const meAfterReg = await fetch(`${BASE}/api/client/auth/me`, { headers: cookieHeader(jar) });
  ok = pass("me after register (session cookie)", meAfterReg.status === 200, String(meAfterReg.status)) && ok;

  const enter = await fetch(`${BASE}/api/client/auth/enter`, {
    headers: cookieHeader(jar),
    redirect: "manual",
  });
  ok =
    pass(
      "GET /enter redirects to account",
      enter.status === 302 && (enter.headers.get("location") || "").includes("/account/"),
      `status=${enter.status} loc=${enter.headers.get("location") ?? ""}`,
    ) && ok;

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
  ok = pass("account.js tryOpenDashboard", accountJs.includes("tryOpenDashboard")) && ok;
  ok = pass("account.js enterClientArea", accountJs.includes("enterClientArea")) && ok;
  ok = pass("account.js enter fallback route", accountJs.includes("/api/client/auth/enter")) && ok;
  ok = pass("account.js no 16-attempt loop", !accountJs.includes("maxAttempts = pendingAuth || justRegistered ? 16")) && ok;

  console.log(`\n${ok ? "ALL PASSED" : "SOME FAILED"}`);
  if (!ok) process.exitCode = 1;
})()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!process.env.DATABASE_URL) return;
    try {
      const { spawnSync } = await import("node:child_process");
      const r = spawnSync(process.execPath, ["--import", "./scripts/load-env.mjs", "./scripts/qa-cleanup-accounts.mjs"], {
        cwd: process.cwd(),
        stdio: "inherit",
        env: process.env,
      });
      if (r.status !== 0) process.exitCode = r.status ?? 1;
    } catch (err) {
      console.error("QA cleanup failed:", err);
      process.exitCode = 1;
    }
  });
