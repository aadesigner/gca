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
  if (!setCookie) return "";
  const parts = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const raw of parts) {
    const pair = raw.split(";")[0]?.trim();
    if (pair?.startsWith("gcap.sid=") && pair.length > "gcap.sid=".length) return pair;
  }
  return parts[0]?.split(";")[0] || "";
}

function responseCookies(res) {
  if (typeof res.headers.getSetCookie === "function") return res.headers.getSetCookie();
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
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
  const regCookie = responseCookies(reg);
  pass("Registration succeeds", reg.status === 201, `id=${regBody.id}`);
  pass("API key issued", Boolean(regBody.apiToken?.value) || Boolean(regBody.testToken?.value));
  pass("API key is production", regBody.apiToken ? regBody.apiToken.isTestOnly === false : regBody.testToken?.isTestOnly === true);
  const regCookieRaw = regCookie.join(" | ");
  pass("Session cookie httpOnly", /httponly/i.test(regCookieRaw));
  pass("Session cookie SameSite=Lax", /samesite=lax/i.test(regCookieRaw));
  pass("No password in register response", !regBody.password && !regBody.passwordHash);

  const clientCookie = cookiePair(regCookie);
  const apiToken = regBody.apiToken?.value || regBody.testToken?.value;

  const clientHitsAdmin = await fetch(`${BASE}/api/admin/api-clients`, {
    headers: { Cookie: clientCookie },
  });
  pass("Client session cannot access admin", clientHitsAdmin.status === 401);

  const prodVin = process.env.QA_REAL_VIN || "2G1FA1E35D9105508";
  const realRetrieve = await req(`/api/v1/vin/${prodVin}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  pass(
    "Real VIN retrieve needs credits",
    regBody.apiToken ? realRetrieve.status === 402 : realRetrieve.status === 403,
    `status=${realRetrieve.status}`,
  );

  const testVin = "1FA6P8CF5K5120103";
  const testCheck = await req(`/api/v1/vin/check/${testVin}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  pass("API key works on curated test VIN", testCheck.status === 200);

  const prodCheck = await req(`/api/v1/vin/check/${prodVin}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  pass(
    "Real VIN check allowed without credit",
    prodCheck.status === 200 || prodCheck.status === 404,
    prodCheck.body?.error?.code || String(prodCheck.status),
  );

  const live = await req("/api/v1/live/vehicles?limit=1", {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  pass("Live feed blocked when not enabled", live.status === 403 || live.status === 503, live.body?.error?.code);

  const regen = await fetch(`${BASE}/api/client/tokens/regenerate`, {
    method: "POST",
    headers: { Cookie: clientCookie, "Content-Type": "application/json" },
  });
  const regenBody = await regen.json();
  pass("Client cannot regenerate API key", regen.status === 403 && (regenBody?.code === "TOKEN_ADMIN_ONLY" || regenBody?.error?.code === "TOKEN_ADMIN_ONLY"), `status=${regen.status} code=${regenBody?.code || regenBody?.error?.code}`);

  const testRetrieve = await req(`/api/v1/vin/${testVin}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  pass(
    "Test VIN retrieve free at zero credits",
    testRetrieve.status === 200 && testRetrieve.body?.meta?.creditCharged === 0,
    `status=${testRetrieve.status}`,
  );

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
  const cookie2 = cookiePair(responseCookies(reg2));

  const t1 = await fetch(`${BASE}/api/client/support/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: clientCookie },
    body: JSON.stringify({ subject: "QA isolation", message: "Private ticket from user 1" }),
  });
  const t1Body = await t1.json();
  const ticketId = t1Body.ticket?.id || t1Body.id;
  pass("Support ticket created", t1.status === 201 || t1.status === 200, `status=${t1.status} id=${ticketId ?? "?"}`);

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
