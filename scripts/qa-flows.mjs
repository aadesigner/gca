/**
 * End-to-end QA: register, login, admin client create, token create, client update.
 * Run: node --import ./scripts/load-env.mjs ./scripts/qa-flows.mjs
 */
const BASE = process.env.QA_BASE_URL || "http://127.0.0.1:5000";
const results = [];

function pass(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
}

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

function cookiePair(setCookie) {
  return setCookie?.split(";")[0] || "";
}

(async () => {
  console.log(`QA flows → ${BASE}\n`);
  const ts = Date.now();
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    console.error("ADMIN_EMAIL and ADMIN_PASSWORD required in .env");
    process.exitCode = 1;
    return;
  }

  const regEmail = `qa-flow-${ts}@example.com`;
  const reg = await fetch(`${BASE}/api/client/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-Id": "qa-flows" },
    body: JSON.stringify({
      email: regEmail,
      telegramUsername: "qaflowuser",
      websiteUrl: "https://example.com",
      password: "SecurePass99!",
      confirmPassword: "SecurePass99!",
    }),
  });
  const regBody = await json(reg);
  const regCookie = cookiePair(reg.headers.get("set-cookie"));
  pass("Register account", reg.status === 201, `id=${regBody.id ?? "?"}`);
  pass("Register issues test token", Boolean(regBody.testToken?.value));
  pass("Register session /me", (await fetch(`${BASE}/api/client/auth/me`, { headers: { Cookie: regCookie } })).status === 200);
  pass("Dashboard loads after register", (await fetch(`${BASE}/api/client/dashboard`, { headers: { Cookie: regCookie } })).status === 200);

  await fetch(`${BASE}/api/client/auth/logout`, { method: "POST", headers: { Cookie: regCookie } });
  const login = await fetch(`${BASE}/api/client/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-Id": "qa-flows" },
    body: JSON.stringify({ email: regEmail, password: "SecurePass99!" }),
  });
  pass("Client login", login.status === 200);

  const adminLogin = await fetch(`${BASE}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  const adminCookie = cookiePair(adminLogin.headers.get("set-cookie"));
  pass("Admin login", adminLogin.status === 200);
  pass("List API clients", (await fetch(`${BASE}/api/admin/api-clients`, { headers: { Cookie: adminCookie } })).status === 200);
  pass("List API tokens", (await fetch(`${BASE}/api/admin/api-tokens`, { headers: { Cookie: adminCookie } })).status === 200);

  const portalEmail = `qa-client-${ts}@example.com`;
  const createClient = await fetch(`${BASE}/api/admin/api-clients`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify({
      name: `QA Client ${ts}`,
      description: "qa-flows",
      email: portalEmail,
      password: "PortalPass99",
      isActive: true,
      creditBalance: 5,
    }),
  });
  const clientBody = await json(createClient);
  const clientId = clientBody.id;
  pass("Create API client (admin)", createClient.status === 201, `id=${clientId ?? clientBody.error ?? "?"}`);

  if (clientId) {
    const createTok = await fetch(`${BASE}/api/admin/api-tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ clientId, name: "QA production token" }),
    });
    const tokBody = await json(createTok);
    pass("Create production token", createTok.status === 201 && Boolean(tokBody.tokenValue), tokBody.error || "");
    pass("List tokens for client", (await fetch(`${BASE}/api/admin/api-tokens?clientId=${clientId}`, { headers: { Cookie: adminCookie } })).status === 200);
    pass("Get client detail", (await fetch(`${BASE}/api/admin/api-clients/${clientId}`, { headers: { Cookie: adminCookie } })).status === 200);

    const put = await fetch(`${BASE}/api/admin/api-clients/${clientId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ name: `QA Client Updated ${ts}` }),
    });
    const putBody = await json(put);
    pass("Update API client", put.status === 200, putBody.error || String(put.status));

    if (tokBody.tokenValue) {
      const vin = await fetch(`${BASE}/api/v1/vin/check/1HGBH41JXMN109186`, {
        headers: { Authorization: `Bearer ${tokBody.tokenValue}` },
      });
      pass("Production token VIN check", vin.status === 200 || vin.status === 404, String(vin.status));
    }

    const portalLogin = await fetch(`${BASE}/api/client/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Id": "qa-flows" },
      body: JSON.stringify({ email: portalEmail, password: "PortalPass99" }),
    });
    pass("Admin-created portal login", portalLogin.status === 200);
  }

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
