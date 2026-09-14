const id = "IC5494339";
const baseHeaders = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
  Accept: "application/json",
  Origin: "https://m.autowini.com",
  Referer: "https://m.autowini.com/",
  "wini-code-select-country": "C1570",
};

async function post(path, body) {
  const r = await fetch(`https://v2api.autowini.com${path}`, {
    method: "POST",
    headers: { ...baseHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  console.log("POST", path, r.status, t.slice(0, 400));
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

for (const path of [
  "/auth/guest",
  "/auth/anonymous",
  "/auth/token",
  "/login/guest",
  "/users/guest",
  "/session/guest",
]) {
  await post(path, {});
  await post(path, { deviceId: "test-device-123" });
}

// try GET token endpoints
for (const path of ["/auth/guest", "/auth/token", "/oauth/token"]) {
  const r = await fetch(`https://v2api.autowini.com${path}`, { headers: baseHeaders });
  console.log("GET", path, r.status, (await r.text()).slice(0, 200));
}
