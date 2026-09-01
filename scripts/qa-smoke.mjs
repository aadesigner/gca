/**
 * Fast post-change smoke QA — local + production.
 * Run: node --import ./scripts/load-env.mjs ./scripts/qa-smoke.mjs
 */
const LOCAL = process.env.QA_BASE_URL || process.env.API_URL || "http://127.0.0.1:5002";
const PROD = process.env.QA_PROD_URL || "https://getcarapi.com";
const results = [];

function pass(scope, name, ok, detail = "") {
  results.push({ scope, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | [${scope}] ${name}${detail ? ` | ${detail}` : ""}`);
}

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

async function get(base, path, init = {}) {
  return fetch(`${base}${path}`, init);
}

(async () => {
  console.log(`QA smoke — local=${LOCAL} prod=${PROD}\n`);

  for (const [scope, base] of [
    ["local", LOCAL],
    ["prod", PROD],
  ]) {
    try {
      const h = await get(base, "/api/healthz");
      const hb = await json(h);
      pass(scope, "healthz", h.status === 200 && hb.status === "ok", String(h.status));
    } catch (e) {
      pass(scope, "healthz", false, e.message);
    }

    try {
      const cfg = await get(base, "/api/client/auth/captcha-config");
      const body = await json(cfg);
      pass(scope, "captcha-config", cfg.status === 200, `enabled=${body.enabled ?? "?"}`);
      pass(
        scope,
        "portal open (register/login)",
        cfg.status === 200 && body.registrationEnabled !== false && body.loginEnabled !== false,
        `reg=${body.registrationEnabled !== false} login=${body.loginEnabled !== false}`,
      );
    } catch (e) {
      pass(scope, "captcha-config", false, e.message);
      pass(scope, "portal open (register/login)", false, e.message);
    }

    const adminClients = await get(base, "/api/admin/api-clients");
    pass(scope, "admin api-clients unauth blocked", adminClients.status === 401, String(adminClients.status));
  }

  const ts = Date.now();
  const optReg = await fetch(`${LOCAL}/api/client/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-Id": "qa-smoke" },
    body: JSON.stringify({
      email: `qa-opt-${ts}@example.com`,
      password: "SecurePass99!",
      confirmPassword: "SecurePass99!",
    }),
  });
  const optBody = await json(optReg);
  pass(
    "local",
    "register without telegram/website",
    optReg.status === 201,
    optReg.status === 201 ? `id=${optBody.id}` : optBody.error || String(optReg.status),
  );

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    for (const [scope, base] of [
      ["local", LOCAL],
      ["prod", PROD],
    ]) {
      try {
        const login = await fetch(`${base}/api/admin/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: scope === "local" ? "http://localhost:3000" : "https://getcarapi.com" },
          body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
        });
        const cookie = login.headers.get("set-cookie")?.split(";")[0] || "";
        pass(scope, "admin login", login.status === 200, String(login.status));

        if (login.status === 200 && cookie) {
          const clients = await fetch(`${base}/api/admin/api-clients`, { headers: { Cookie: cookie } });
          const clientsBody = await json(clients);
          pass(
            scope,
            "admin list api-clients (live feed fields)",
            clients.status === 200 && Array.isArray(clientsBody),
            clients.status === 200 ? `count=${clientsBody.length}` : clientsBody.error || String(clients.status),
          );

          const jobs = await fetch(`${base}/api/admin/jobs?limit=5`, { headers: { Cookie: cookie } });
          const jobsBody = await json(jobs);
          pass(scope, "admin list jobs", jobs.status === 200, `status=${jobs.status}`);

          if (scope === "prod" && Array.isArray(jobsBody?.items ?? jobsBody)) {
            const items = jobsBody.items ?? jobsBody;
            const imRunning = items.filter(
              (j) => j.provider?.internalName === "import_motor" || j.internalName === "import_motor",
            );
            const imActive = imRunning.filter((j) => j.status === "running" || j.status === "pending");
            pass(
              "prod",
              "import_motor not active on production",
              imActive.length === 0,
              imActive.length ? `active=${imActive.map((j) => `${j.id}:${j.status}`).join(",")}` : "none running/pending in sample",
            );
          }
        }
      } catch (e) {
        pass(scope, "admin login", false, e.message);
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("FAILED:");
    for (const f of failed) console.log(` - [${f.scope}] ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
