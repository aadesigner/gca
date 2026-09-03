import pg from "pg";
import { createRequire } from "module";
// Use dynamic import of compiled? Just replicate via fetch to prod API if we have a test token
const PROD = "https://getcarapi.com";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const login = await fetch(`${PROD}/api/admin/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const res = await fetch(`${PROD}/api/admin/vehicles/by-vin/WDDUX8GB8JA397509`, {
  headers: { Cookie: cookie },
});
console.log("admin vehicle", res.status);
const text = await res.text();
let j; try { j = JSON.parse(text); } catch { console.log(text.slice(0,500)); process.exit(0); }
const listings = (j.listings || j.vehicle?.listings || []).map(l => ({
  priceAmount: l.priceAmount, priceCurrency: l.priceCurrency, priceUsd: l.priceUsd, priceEur: l.priceEur, priceKrw: l.priceKrw, sourceId: l.sourceId
}));
console.log("listings", JSON.stringify(listings, null, 2));
const auctions = j.auctionSales || j.vehicle?.auctionSales || [];
console.log("auctionSales", JSON.stringify(auctions, null, 2));
