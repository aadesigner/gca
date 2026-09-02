/**
 * Security + functional QA for client portal, admin, and public API.
 * Run: node --import ./scripts/load-env.mjs ./scripts/qa-security.mjs
 */
const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:5000";
const results = [];

async function req(path, init = {}) {
  const url = `${BASE}${path}`;
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: r.status, body, headers: r.headers, setCookie: r.headers.get("set-cookie") };
}

function pass(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
}

function cookiePair(setCookie) {
  return setCookie?.split(";")[0] || "";
}

(async () => {
  console.log(`QA security suite → ${BASE}\n`);

  const adminClients = await req("/api/admin/api-clients");
  pass("Admin API blocked without session", adminClients.status === 401, `status=${adminClients.status}`);

  const dash = await req("/api/client/dashboard");
  pass("Client dashboard blocked without session", dash.status === 401);

  const sqli = await req("/api/client/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "' OR 1=1--", password: "x" }),
  });
  pass("SQLi-style login rejected", sqli.status === 401 || sqli.status === 400, `status=${sqli.status}`);

  const ar = await req("/api/client/access-request", {
    method: "POST",
    body: JSON.stringify({ email: "a@b.com", serviceInterest: "both", message: "hello world test" }),
  });
  pass("Legacy access-request disabled (410)", ar.status === 410);

  const badReg = await req("/api/client/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "bad@test.com", password: "short", confirmPassword: "short" }),
  });
  pass("Register rejects invalid payload", badReg.status === 400, badReg.body?.error?.slice?.(0, 80));

  const ts = Date.now();
  const email = `qa-sec-${ts}@example.com`;
  const reg = await fetch(`${BASE}/api/client/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      telegramUsername: "qasecuser",
      websiteUrl: "https://example.com",
      password: "SecurePass99!",
      confirmPassword: "SecurePass99!",
    }),
  });
  const regBody = await reg.json();
  const regCookie = reg.headers.get("set-cookie") || "";
  pass("Registration succeeds", reg.status === 201, `id=${regBody.id}`);
  pass("Test token issued (test-only)", Boolean(regBody.testToken?.value) && regBody.testToken?.isTestOnly === true);
  pass("Session cookie httpOnly", /httponly/i.test(regCookie));
  pass("Session cookie SameSite=Lax", /samesite=lax/i.test(regCookie));
  pass("No password in register response", !regBody.password && !regBody.passwordHash);

  const clientCookie = cookiePair(regCookie);
  const testToken = regBody.testToken?.value;

  const clientHitsAdmin = await fetch(`${BASE}/api/admin/api-clients`, {
    headers: { Cookie: clientCookie },
  });
  pass("Client session cannot access admin", clientHitsAdmin.status === 401);

  const prodVin = "1HGBH41JXMN109186";
  const testRetrieve = await req(`/api/v1/vin/${prodVin}`, {
    headers: { Authorization: `Bearer ${testToken}` },
  });
  pass("Test token blocked on production VIN", testRetrieve.status === 403, `status=${testRetrieve.status}`);

  const testVin = "1FA6P8CF5K5120103";
  const testCheck = await req(`/api/v1/vin/check/${testVin}`, {
    headers: { Authorization: `Bearer ${testToken}` },
  });
  pass("Test token works on curated test VIN", testCheck.status === 200);

  const prodCheck = await req(`/api/v1/vin/check/${prodVin}`, {
    headers: { Authorization: `Bearer ${testToken}` },
  });
  pass("Test token blocked on non-test VIN check", prodCheck.status === 403, prodCheck.body?.error?.code);

  const live = await req("/api/v1/live/vehicles?limit=1", {
    headers: { Authorization: `Bearer ${testToken}` },
  });
  pass("Live feed blocked when not enabled", live.status === 403, live.body?.error?.code);

  const badTok = await req(`/api/v1/vin/check/${testVin}`, {
    headers: { Authorization: "Bearer not_a_token" },
  });
  pass("Malformed API token rejected", badTok.status === 401, badTok.body?.error?.code);

  const adminLogin = await fetch(`${BASE}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  const adminCookie = cookiePair(adminLogin.headers.get("set-cookie"));
  pass("Admin login succeeds", adminLogin.status === 200);

  const csrfBad = await fetch(`${BASE}/api/admin/api-clients/1`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
      Origin: "https://evil.example.com",
    },
    body: JSON.stringify({ name: "Hacked" }),
  });
  pass("Admin mutation blocked from evil Origin", csrfBad.status === 403, `status=${csrfBad.status}`);

  const adminHitsClient = await fetch(`${BASE}/api/client/dashboard`, {
    headers: { Cookie: adminCookie },
  });
  pass("Admin session cannot access client dashboard", adminHitsClient.status === 401);

  const email2 = `qa-sec2-${ts}@example.com`;
  const reg2 = await fetch(`${BASE}/api/client/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: email2,
      telegramUsername: "qasecuser2",
      websiteUrl: "https://example2.com",
      password: "SecurePass99!",
      confirmPassword: "SecurePass99!",
    }),
  });
  const cookie2 = cookiePair(reg2.headers.get("set-cookie"));

  const t1 = await fetch(`${BASE}/api/client/support/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: clientCookie },
    body: JSON.stringify({ subject: "QA isolation", message: "Private ticket from user 1" }),
  });
  const t1Body = await t1.json();
  const ticketId = t1Body.ticket?.id || t1Body.id;
  pass("Support ticket created", t1.status === 201 || t1.status === 200, `id=${ticketId}`);

  if (ticketId) {
    const crossRead = await fetch(`${BASE}/api/client/support/tickets/${ticketId}`, {
      headers: { Cookie: cookie2 },
    });
    pass("Support tickets isolated between clients", crossRead.status === 404 || crossRead.status === 403, `status=${crossRead.status}`);
  }

  const cfg = await req("/api/client/auth/captcha-config");
  pass("Registration enabled in portal config", cfg.body?.registrationEnabled === true);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("FAILED:");
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
