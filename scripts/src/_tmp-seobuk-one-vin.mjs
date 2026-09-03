const PROD = process.env.PROD_API_URL || "https://getcarapi.com";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const res = await fetch(`${PROD}/api/admin/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const started = await fetch(`${PROD}/api/admin/seobuk/photos/backfill`, {
  method: "POST",
  headers: { Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ vin: "WBA11BH08NWX62978", delayMs: 1500, minPhotos: 8 }),
});
console.log("vin repair", started.status, await started.text());
