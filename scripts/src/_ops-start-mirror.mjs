/** Start prod mirror backfill and poll until batches are processing. */
const PROD = process.env.PROD_API_URL || "https://getcarapi.com";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

async function login() {
  const res = await fetch(`${PROD}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function mirrorStatus(cookie) {
  const res = await fetch(`${PROD}/api/admin/photos/mirror-status`, { headers: { Cookie: cookie } });
  return res.json();
}

const cookie = await login();
console.log("Starting mirror backfill…");
const start = await fetch(`${PROD}/api/admin/photos/mirror-backfill/start`, {
  method: "POST",
  headers: { Cookie: cookie },
});
console.log("Start response:", start.status, await start.text());

for (let i = 1; i <= 12; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = await mirrorStatus(cookie);
  const b = s.backfill ?? {};
  console.log(
    `Poll ${i}: running=${b.running} batches=${b.batches} attempted=${b.attempted} uploaded=${b.uploaded} pending=${s.pending}`,
  );
  if (b.batches > 0 || b.attempted > 0) {
    console.log("\nBackfill is processing.");
    process.exit(0);
  }
}
console.log("\nBackfill may still be waiting on lock — check again in a minute.");
process.exit(0);
