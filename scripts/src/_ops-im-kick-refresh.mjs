/**
 * Finish idle IM brand pass (all shards completed) and kick a fresh brand refresh,
 * then unpark Encar jobs that were paused for the IM brand crawl.
 */
import pg from "pg";

const API = process.env.API_URL || "http://127.0.0.1:5000";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error("ADMIN_EMAIL/ADMIN_PASSWORD required");

async function login() {
  const res = await fetch(`${API}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${text.slice(0, 200)}`);
  return json;
}

const cookie = await login();

const brands = [
  "audi","mercedes-benz","bmw","volkswagen","porsche","hyundai","toyota","ford","honda","nissan",
  "kia","lexus","land-rover","chevrolet","jeep","mazda","subaru","volvo","tesla","infiniti",
  "acura","gmc","dodge","ram","mitsubishi","genesis","mini","jaguar","bentley","peugeot",
  "renault","skoda","opel","suzuki","fiat","citroen","seat","cadillac","chrysler","buick",
  "lincoln","alfa-romeo","maserati",
];

const im = await api(cookie, "POST", "/api/admin/jobs/360/resume", {
  resetProgress: true,
  jobType: "full_collection",
  filterParams: {
    fullCrawl: true,
    concurrency: 10,
    delayMs: 85,
    skipRecentHours: 0,
    maxPages: 0,
    maxListings: 0,
    crawlMode: "brands",
    brands,
  },
});
console.log("IM", { status: im.status, id: im.id, type: im.jobType });

for (const id of [361, 362]) {
  try {
    const j = await api(cookie, "POST", `/api/admin/jobs/${id}/resume`, {
      resetProgress: false,
    });
    console.log("ENCAR", id, j.status);
  } catch (e) {
    console.log("ENCAR", id, String(e.message || e));
  }
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows } = await c.query(
  `SELECT id, status, pages_processed, listings_fetched, vins_new, updated_at,
          crawl_state::json->>'currentShardId' AS shard
   FROM collection_jobs WHERE id IN (360,361,362) ORDER BY id`,
);
console.log(rows);
await c.end();
