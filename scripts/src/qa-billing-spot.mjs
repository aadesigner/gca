/**
 * Spot-check billing: find a real (non-test) VIN on prod and verify 402 at 0 credits.
 */
const PROD = process.env.QA_PROD_URL || "https://getcarapi.com";
const TEST_VINS = new Set([
  "1FA6P8CF5K5120103",
  "ZAM57XSA5H1238315",
  "WDDUX8GB8JA397509",
  "ZAM57XSA4E1123233",
  "WBS3C910XFP708160",
]);

async function api(path, token, init = {}) {
  const res = await fetch(`${PROD}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const ts = Date.now();
const reg = await api("/api/client/auth/register", null, {
  method: "POST",
  headers: { "X-Device-Id": `qa-billing-spot-${ts}` },
  body: JSON.stringify({
    email: `qa-bill-spot-${ts}@example.com`,
    password: "SecurePass99!",
    confirmPassword: "SecurePass99!",
  }),
});

console.log("Register:", reg.status, "| credits:", reg.body.creditBalance, "| key:", reg.body.apiToken?.value ? "yes" : "no");
const token = reg.body.apiToken?.value;
if (!token) process.exit(1);

// Discover a real VIN via test-vins' siblings or vin/check on known DB vins from public site
const seedChecks = [
  ...[...TEST_VINS].map((v) => v.slice(0, -1) + "0"), // unlikely
  "5UXCR6C05L9B12345",
  "1C4RJFBG0LC123456",
  "KMHRC8A37MU000001",
  "WA1AAAFY4J2000001",
];

// Also try VINs from test retrieve - they exist; for 402 we need NON-test in DB
// Query prod: use check on VINs from car-history pages - try copart style from docs
const extra = ["2G1FC1ED9B9207488", "2G1FA1E35D9105508", "5NPE34AF4FH000001"];
for (const vin of [...seedChecks, ...extra]) {
  if (TEST_VINS.has(vin)) continue;
  const check = await api(`/api/v1/vin/check/${vin}`, token);
  if (check.status === 200 && check.body.data?.exists) {
    console.log("Found real VIN in DB:", vin, "| country:", check.body.data.country);
    const retrieve = await api(`/api/v1/vin/${vin}`, token);
    console.log(
      "Retrieve at 0 credits:",
      retrieve.status,
      retrieve.body.error?.code || "OK",
      "| creditCharged:",
      retrieve.body.meta?.creditCharged ?? "n/a",
    );
    process.exit(retrieve.status === 402 ? 0 : 1);
  }
}

console.log("No suitable real VIN found in prod DB for 402 test — try admin or DB query.");
process.exit(2);
