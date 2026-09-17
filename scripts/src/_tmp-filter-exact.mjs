// Reproduce exact admin client query string
const params = {
  country: "South Korea",
  providerId: 165,
  sortBy: "createdAt",
  sortOrder: "desc",
  limit: 50,
  offset: 0,
};
const qs = new URLSearchParams();
Object.entries(params).forEach(([k,v]) => { if (v !== undefined) qs.append(k, String(v)); });
console.log("qs", qs.toString());

const login = await fetch("http://127.0.0.1:5000/api/admin/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
});
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const t0 = Date.now();
const res = await fetch(`http://127.0.0.1:5000/api/admin/vehicles?${qs}`, { headers: { Cookie: cookie } });
const text = await res.text();
console.log("local list", res.status, Date.now()-t0, text.slice(0, 200));

// Check statement timeout with EXPLAIN-ish by hitting with offset
const t1 = Date.now();
const res2 = await fetch(`http://127.0.0.1:5000/api/admin/vehicles?${qs}&offset=0&limit=50`, { headers: { Cookie: cookie } });
console.log("local list2", res2.status, Date.now()-t1);

// Check if countryFilterValues creates huge OR that breaks
const { countryFilterValues } = await import("../../artifacts/api-server/src/lib/geo.ts").catch(() => ({ countryFilterValues: null }));
