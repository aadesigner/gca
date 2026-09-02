/** Local crawl / Import Motor status via admin API only (no extra DB pools). */
const API = process.env.API_URL || "http://127.0.0.1:5000";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

async function login() {
  const res = await fetch(`${API}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

const cookie = await login();
const jobsRes = await fetch(`${API}/api/admin/jobs?limit=40`, { headers: { Cookie: cookie } });
const jobsBody = await jobsRes.json();
const jobs = jobsBody.items ?? jobsBody.jobs ?? jobsBody.data ?? (Array.isArray(jobsBody) ? jobsBody : []);
console.log("Local jobs total:", jobs.length);
for (const j of jobs.filter((x) => x.status === "running")) {
  console.log(`  RUN #${j.id} ${j.provider?.internalName ?? "?"} processed=${j.itemsProcessed ?? j.listingsFetched}`);
}
for (const id of [360, 362, 361]) {
  const r = await fetch(`${API}/api/admin/jobs/${id}`, { headers: { Cookie: cookie } });
  if (!r.ok) {
    console.log(`Job ${id}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    continue;
  }
  const j = await r.json();
  console.log(`Job ${id}: status=${j.status} pages=${j.pagesProcessed} processed=${j.itemsProcessed} vins=${j.vinsFound} err=${j.errorMessage ?? "none"}`);
}
