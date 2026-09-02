/**
 * Production VIN API QA — test keys, curated VINs, production restrictions.
 * Run: node --import ./scripts/load-env.mjs ./scripts/src/qa-prod-api.mjs
 */
const PROD = process.env.QA_PROD_URL || "https://getcarapi.com";

const TEST_VINS = [
  "1FA6P8CF5K5120103",
  "ZAM57XSA5H1238315",
  "WDDUX8GB8JA397509",
  "ZAM57XSA4E1123233",
  "WBS3C910XFP708160",
];

const results = [];

function pass(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
}

async function api(path, init = {}) {
  const res = await fetch(`${PROD}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body };
}

(async () => {
  console.log(`Production API QA → ${PROD}\n`);

  const health = await api("/api/healthz");
  pass("healthz", health.status === 200 && health.body.status === "ok", String(health.status));

  const ts = Date.now();
  const reg = await api("/api/client/auth/register", {
    method: "POST",
    headers: { "X-Device-Id": "qa-prod-api" },
    body: JSON.stringify({
      email: `qa-api-${ts}@example.com`,
      password: "SecurePass99!",
      confirmPassword: "SecurePass99!",
    }),
  });
  pass("register + test token", reg.status === 201 && reg.body.testToken?.value, reg.status === 201 ? "ok" : reg.body.error || String(reg.status));

  const testToken = reg.body.testToken?.value;
  if (!testToken) {
    console.log("\nCannot continue without test token.");
    process.exit(1);
  }

  pass("test token is test-only", reg.body.testToken?.isTestOnly === true);

  const list = await api("/api/v1/test-vins", {
    headers: { Authorization: `Bearer ${testToken}` },
  });
  pass(
    "GET /v1/test-vins",
    list.status === 200 && list.body.success && Array.isArray(list.body.data?.testVins),
    `count=${list.body.data?.testVins?.length ?? "?"}`,
  );

  for (const vin of TEST_VINS) {
    const check = await api(`/api/v1/vin/check/${vin}`, {
      headers: { Authorization: `Bearer ${testToken}` },
    });
    pass(
      `check ${vin.slice(-6)}`,
      check.status === 200 && check.body.success && check.body.data?.exists === true,
      check.body.data?.exists ? `country=${check.body.data.country ?? "null"}` : check.body.error?.code || String(check.status),
    );

    const retrieve = await api(`/api/v1/vin/${vin}`, {
      headers: { Authorization: `Bearer ${testToken}` },
    });
    const photos = retrieve.body.data?.photos?.length ?? 0;
    const events = retrieve.body.data?.events?.length ?? 0;
    pass(
      `retrieve ${vin.slice(-6)}`,
      retrieve.status === 200 &&
        retrieve.body.success &&
        retrieve.body.meta?.creditCharged === 0 &&
        retrieve.body.meta?.testVin === true,
      retrieve.status === 200
        ? `photos=${photos} events=${events} cr=${retrieve.body.meta?.creditCharged}`
        : retrieve.body.error?.code || String(retrieve.status),
    );
  }

  const prodVin = "1HGBH41JXMN109186";
  const blockedCheck = await api(`/api/v1/vin/check/${prodVin}`, {
    headers: { Authorization: `Bearer ${testToken}` },
  });
  pass("test key blocked on random VIN", blockedCheck.status === 403, blockedCheck.body.error?.code || String(blockedCheck.status));

  const live = await api("/api/v1/live/vehicles?limit=1", {
    headers: { Authorization: `Bearer ${testToken}` },
  });
  pass("test key blocked on live feed", live.status === 403, live.body.error?.code || String(live.status));

  const noAuth = await api(`/api/v1/vin/check/${TEST_VINS[0]}`);
  pass("no token rejected", noAuth.status === 401, noAuth.body.error?.code || String(noAuth.status));

  const badToken = await api(`/api/v1/vin/check/${TEST_VINS[0]}`, {
    headers: { Authorization: "Bearer vdi_not_real" },
  });
  pass("bad token rejected", badToken.status === 401, badToken.body.error?.code || String(badToken.status));

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("FAILED:");
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
