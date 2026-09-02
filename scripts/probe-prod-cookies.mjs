const BASE = "https://getcarapi.com";
const email = `qa-cookie-${Date.now()}@example.com`;

const reg = await fetch(`${BASE}/api/client/auth/register`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Device-Id": "qa-cookie-probe01",
    Origin: BASE,
  },
  body: JSON.stringify({
    email,
    password: "SecurePass99!",
    confirmPassword: "SecurePass99!",
  }),
});

console.log("register status:", reg.status);
const setCookies = reg.headers.getSetCookie?.() ?? [];
console.log("Set-Cookie count:", setCookies.length);
for (const c of setCookies) console.log("  ", c);

const login = await fetch(`${BASE}/api/client/auth/login`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Device-Id": "qa-cookie-probe01",
    Origin: BASE,
  },
  body: JSON.stringify({ email, password: "SecurePass99!" }),
});
console.log("\nlogin status:", login.status);
const loginCookies = login.headers.getSetCookie?.() ?? [];
for (const c of loginCookies) console.log("  ", c);

// Also test www
const BASE_WWW = "https://www.getcarapi.com";
const regWww = await fetch(`${BASE_WWW}/api/client/auth/register`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Device-Id": "qa-cookie-probe02",
    Origin: BASE_WWW,
  },
  body: JSON.stringify({
    email: `qa-www-${Date.now()}@example.com`,
    password: "SecurePass99!",
    confirmPassword: "SecurePass99!",
  }),
});
console.log("\nwww register status:", regWww.status);
for (const c of regWww.headers.getSetCookie?.() ?? []) console.log("  ", c);
