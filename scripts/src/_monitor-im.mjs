/**
 * Monitor Import Motor crawl: country focus, progress, CDP health.
 * Prints a status line every ~45s.
 */
const API = process.env.API_URL || "http://127.0.0.1:5000";
const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in the environment");
}
const JOB_ID = Number(process.env.IM_JOB_ID || 0);

async function login() {
  const res = await fetch(`${API}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function status(cookie) {
  let job;
  if (JOB_ID) {
    job = await (await fetch(`${API}/api/admin/jobs/${JOB_ID}`, { headers: { Cookie: cookie } })).json();
  } else {
    const list = await (await fetch(`${API}/api/admin/jobs?limit=40`, { headers: { Cookie: cookie } })).json();
    job = (list.items || []).find(
      (j) => j.providerName === "Import Motor" && ["running", "pending"].includes(j.status),
    );
  }
  let chrome = { title: "?", url: "?" };
  try {
    const tabs = await (await fetch(`${CDP}/json/list`)).json();
    const t = tabs.find((x) => /import-motor/.test(x.url || "")) || tabs.find((x) => x.type === "page");
    chrome = { title: t?.title || "?", url: t?.url || "?" };
  } catch {
    chrome = { title: "CDP_DOWN", url: "" };
  }
  const m = String(chrome.url).match(/buyer-locations\/([a-z]{2})(?:\?page=(\d+))?/i);
  const vinM = String(chrome.url).match(/\/v\/([A-HJ-NPR-Z0-9]{17})/i);
  return {
    jobId: job?.id,
    status: job?.status,
    pages: job?.pagesProcessed,
    discovered: job?.itemsDiscovered,
    fetched: job?.listingsFetched,
    vins: job?.vinsFound,
    vinsNew: job?.vinsNew,
    failed: job?.itemsFailed,
    err: job?.errorMessage,
    focusCountry: m?.[1]?.toLowerCase() || (vinM ? "detail" : "?"),
    focusPage: m?.[2] || null,
    chromeUrl: chrome.url,
    chromeTitle: chrome.title,
  };
}

const cookie = await login();
console.log("monitor started", new Date().toISOString());
for (let i = 0; i < 120; i++) {
  try {
    const s = await status(cookie);
    console.log(
      JSON.stringify({
        t: new Date().toISOString().slice(11, 19),
        ...s,
      }),
    );
    if (s.status === "completed" || s.status === "failed" || s.status === "cancelled") break;
  } catch (e) {
    console.log(JSON.stringify({ t: new Date().toISOString().slice(11, 19), error: e.message }));
  }
  await new Promise((r) => setTimeout(r, 45_000));
}
