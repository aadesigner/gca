/**
 * Pause IM 360, switch to buyer-locations country mode, resume from Georgia.
 * LOCAL / OFFLINE ONLY — refuses production/Railway unless IMPORT_MOTOR_ON_PRODUCTION=1.
 * Must pause first so the worker cannot overwrite crawl_state.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-im-country-mode.mjs
 */
import pg from "pg";

const isProd =
  process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);
if (isProd && process.env.IMPORT_MOTOR_ON_PRODUCTION !== "1") {
  console.error("Refusing: Import Motor country crawl is local/offline only (set IMPORT_MOTOR_ON_PRODUCTION=1 to override).");
  process.exit(1);
}

const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const GE_RESUME_PAGE = Math.max(1, Number(process.env.IM_GE_RESUME_PAGE || 1102) || 1102);
const API = process.env.API_URL || "http://127.0.0.1:5000";

const PRIORITY = [
  "me", "mk", "xk", "ba", "al", "si", "hr", "bg", "rs", "ro", "gr",
  "ge", "am", "az", "md", "ee", "lv", "lt", "sk", "hu", "cz", "fi", "ie", "pt",
  "at", "be", "nl", "se", "no", "dk", "ch", "pl", "es", "it", "fr", "de", "gb", "ua",
  "cy", "jo", "lb", "bh", "qa", "kw", "om", "ae", "il", "iq", "sa", "tr",
  "ru",
];
const BALKANS_DONE = new Set([
  "me", "mk", "xk", "ba", "al", "si", "hr", "bg", "rs", "ro", "gr",
]);
const COUNTRIES = [...PRIORITY, "*rest"];
const CONC = Math.min(10, Math.max(8, Number(process.env.IMPORT_MOTOR_CONCURRENCY || 10) || 10));
const DELAY = Math.max(75, Number(process.env.IMPORT_MOTOR_DELAY_MS || 85) || 85);
const far = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

async function login() {
  const res = await fetch(`${API}/api/admin/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      cookie,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 240)}`);
  return json;
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const cookie = await login();

// Park competitors
const others = await c.query(
  `SELECT id, job_config FROM collection_jobs
   WHERE status IN ('running','pending','paused','cancelled') AND id <> $1`,
  [JOB_ID],
);
for (const row of others.rows) {
  let ocfg = {};
  try {
    ocfg = JSON.parse(row.job_config || "{}");
  } catch {
    ocfg = {};
  }
  ocfg.nextRunAt = far;
  await c.query(
    `UPDATE collection_jobs SET status='completed', completed_at=now(), job_config=$1,
     error_message='parked for import_motor country crawl', updated_at=now() WHERE id=$2`,
    [JSON.stringify(ocfg), row.id],
  );
}
console.log("parked", others.rows.map((r) => r.id));

// Pause IM so worker drops in-memory brand state
const before = await c.query(`SELECT status FROM collection_jobs WHERE id=$1`, [JOB_ID]);
if (["running", "pending"].includes(before.rows[0]?.status)) {
  await api(cookie, "POST", `/api/admin/jobs/${JOB_ID}/pause`, {});
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    const { rows } = await c.query(`SELECT status FROM collection_jobs WHERE id=$1`, [JOB_ID]);
    if (rows[0]?.status === "paused") break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const { rows: stRows } = await c.query(`SELECT status FROM collection_jobs WHERE id=$1`, [JOB_ID]);
  if (stRows[0]?.status !== "paused") throw new Error(`could not pause job (status=${stRows[0]?.status})`);
  console.log("paused");
}

const cfg = {
  crawlMode: "countries",
  countries: COUNTRIES,
  fullCrawlCountries: COUNTRIES,
  fullCrawl: true,
  brands: [],
  concurrency: CONC,
  delayMs: DELAY,
  detailLevel: "full",
  skipRecentHours: 0,
  retryCount: 5,
  maxPages: 0,
  maxListings: 0,
  repeatHours: 6,
};

const shards = COUNTRIES.map((cc) => {
  const id = `im-${cc === "*rest" ? "rest" : cc}`;
  const isGe = cc === "ge";
  const doneBalkans = BALKANS_DONE.has(cc);
  return {
    id,
    label: cc === "*rest" ? "Other destinations" : cc.toUpperCase(),
    status: doneBalkans ? "completed" : "pending",
    nextPage: isGe ? GE_RESUME_PAGE : 1,
    pagesProcessed: doneBalkans ? 1 : isGe ? Math.max(0, GE_RESUME_PAGE - 1) : 0,
    itemsDiscovered: 0,
    listingsFetched: 0,
    discoverFailures: 0,
    cooldownUntil: null,
    lastError: doneBalkans ? "completed before brand switch" : null,
    filters: {
      crawlMode: "countries",
      countries: [cc],
      brands: [],
      fullCrawl: true,
      fullCrawlCountries: COUNTRIES,
      concurrency: CONC,
      delayMs: DELAY,
      detailLevel: "full",
      skipRecentHours: 0,
    },
  };
});

const state = {
  version: 1,
  strategy: "year",
  currentShardId: "im-ge",
  shards,
  lastBlock: null,
  lastHealthSnapshot: null,
};

await c.query(
  `UPDATE collection_jobs
   SET status='paused',
       job_type='full_collection',
       job_config=$1,
       crawl_state=$2,
       completed_at=NULL,
       error_message=NULL,
       updated_at=now()
   WHERE id=$3`,
  [JSON.stringify(cfg), JSON.stringify(state), JOB_ID],
);
console.log(
  JSON.stringify(
    {
      mode: "countries",
      countries: COUNTRIES.length,
      current: "im-ge",
      gePage: GE_RESUME_PAGE,
      balkansDone: BALKANS_DONE.size,
      conc: CONC,
    },
    null,
    2,
  ),
);

// Resume without resetProgress so our shards stick
const resumed = await api(cookie, "POST", `/api/admin/jobs/${JOB_ID}/resume`, {
  resetProgress: false,
  jobType: "full_collection",
  filterParams: {
    crawlMode: "countries",
    countries: COUNTRIES,
    fullCrawlCountries: COUNTRIES,
    brands: [],
    fullCrawl: true,
    concurrency: CONC,
    delayMs: DELAY,
    skipRecentHours: 0,
    maxPages: 0,
    maxListings: 0,
    retryCount: 5,
    detailLevel: "full",
  },
});
console.log("resumed", resumed.status);

// Re-assert crawl_state after resume (some resume paths rebuild shards from brands)
await new Promise((r) => setTimeout(r, 2000));
const after = await c.query(`SELECT job_config, crawl_state, status FROM collection_jobs WHERE id=$1`, [
  JOB_ID,
]);
let acfg = JSON.parse(after.rows[0].job_config || "{}");
let ast = JSON.parse(after.rows[0].crawl_state || "{}");
const hasBrand = (ast.shards || []).some((s) => String(s.id).startsWith("im-brand-"));
const hasGe = (ast.shards || []).some((s) => s.id === "im-ge");
if (hasBrand || !hasGe || acfg.crawlMode !== "countries") {
  console.log("resume drifted — rewriting country state");
  acfg = { ...acfg, ...cfg, brands: [] };
  delete acfg.nextRunAt;
  await c.query(
    `UPDATE collection_jobs SET job_config=$1, crawl_state=$2, status='pending', updated_at=now() WHERE id=$3`,
    [JSON.stringify(acfg), JSON.stringify(state), JOB_ID],
  );
}

const verify = await c.query(`SELECT status, job_config, crawl_state FROM collection_jobs WHERE id=$1`, [
  JOB_ID,
]);
const vcfg = JSON.parse(verify.rows[0].job_config || "{}");
const vst = JSON.parse(verify.rows[0].crawl_state || "{}");
const ge = (vst.shards || []).find((s) => s.id === "im-ge");
console.log(
  JSON.stringify(
    {
      status: verify.rows[0].status,
      crawlMode: vcfg.crawlMode,
      brands: vcfg.brands?.length || 0,
      countries: vcfg.countries?.length,
      current: vst.currentShardId,
      ge: ge ? { status: ge.status, next: ge.nextPage } : null,
      sample: (vst.shards || []).slice(10, 16).map((s) => `${s.id}:${s.status}:p${s.nextPage}`),
    },
    null,
    2,
  ),
);

try {
  const heal = await api(cookie, "POST", "/api/admin/import-motor/cdp-heal", {});
  console.log("cdp_heal", heal);
} catch (e) {
  console.log("cdp_heal", e.message);
}

await c.end();
