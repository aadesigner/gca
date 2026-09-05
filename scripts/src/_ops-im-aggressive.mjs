/**
 * Aggressive local Import Motor country crawl — CF-safe multi-tab settings.
 * LOCAL / OFFLINE ONLY — refuses production/Railway unless IMPORT_MOTOR_ON_PRODUCTION=1.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-im-aggressive.mjs
 */
import pg from "pg";

const isProd =
  process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);
if (isProd && process.env.IMPORT_MOTOR_ON_PRODUCTION !== "1") {
  console.error("Refusing: Import Motor crawl is local/offline only.");
  process.exit(1);
}

const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const CONC = Math.min(10, Math.max(8, Number(process.env.IMPORT_MOTOR_CONCURRENCY || 10) || 10));
const DELAY = Math.max(75, Number(process.env.IMPORT_MOTOR_DELAY_MS || 85) || 85);
const API = process.env.API_URL || "http://127.0.0.1:5000";
const far = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const others = await c.query(
  `SELECT id, job_config FROM collection_jobs
   WHERE status IN ('running','pending','paused','cancelled') AND id <> $1`,
  [JOB_ID],
);
for (const row of others.rows) {
  let cfg = {};
  try {
    cfg = JSON.parse(row.job_config || "{}");
  } catch {
    cfg = {};
  }
  cfg.nextRunAt = far;
  await c.query(
    `UPDATE collection_jobs SET status='completed', completed_at=now(), job_config=$1,
     error_message='parked for import_motor brand crawl', updated_at=now() WHERE id=$2`,
    [JSON.stringify(cfg), row.id],
  );
}
console.log("parked", others.rows.map((r) => r.id));

const { rows } = await c.query(`SELECT job_config, crawl_state FROM collection_jobs WHERE id=$1`, [
  JOB_ID,
]);
let cfg = {};
let st = {};
try {
  cfg = JSON.parse(rows[0].job_config || "{}");
} catch {
  cfg = {};
}
try {
  st = JSON.parse(rows[0].crawl_state || "{}");
} catch {
  st = {};
}

cfg.crawlMode = "brands";
cfg.fullCrawl = true;
cfg.countries = [];
cfg.concurrency = CONC;
cfg.delayMs = DELAY;
cfg.detailLevel = "full";
cfg.skipRecentHours = 0;
cfg.retryCount = 5;
cfg.maxPages = 0;
cfg.maxListings = 0;
cfg.repeatHours = 6;
delete cfg.origins;
delete cfg.fullCrawlCountries;
delete cfg.nextRunAt;
if (!Array.isArray(cfg.brands) || cfg.brands.length === 0) {
  cfg.brands = [
    "audi", "mercedes-benz", "bmw", "volkswagen", "porsche", "hyundai", "toyota",
    "ford", "honda", "nissan", "kia", "lexus", "land-rover", "chevrolet", "jeep",
    "mazda", "subaru", "volvo", "tesla", "infiniti", "acura", "gmc", "dodge", "ram",
    "mitsubishi", "genesis", "mini", "jaguar", "bentley", "peugeot", "renault",
    "skoda", "opel", "suzuki", "fiat", "citroen", "seat", "cadillac", "chrysler",
    "buick", "lincoln", "alfa-romeo", "maserati",
  ];
}

const brandShards = (st.shards || []).filter((s) => String(s.id || "").startsWith("im-brand-"));
if (brandShards.length === 0) {
  console.log("rebuilding brand shards from cfg.brands");
  st.shards = cfg.brands.map((brand) => ({
    id: `im-brand-${brand}`,
    label: brand
      .split("-")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" "),
    status: "pending",
    nextPage: 1,
    pagesProcessed: 0,
    itemsDiscovered: 0,
    listingsFetched: 0,
    discoverFailures: 0,
    cooldownUntil: null,
    lastError: null,
    filters: {
      crawlMode: "brands",
      brands: [brand],
      countries: [],
      fullCrawl: true,
      concurrency: CONC,
      delayMs: DELAY,
      detailLevel: "full",
      skipRecentHours: 0,
    },
  }));
  st.version = 1;
  st.strategy = "year";
  st.currentShardId = st.shards[0]?.id ?? null;
} else {
  for (const s of brandShards) {
    if (s.status === "completed" && String(s.lastError || "").includes("already crawled")) {
      s.status = "pending";
      s.lastError = null;
    }
    if (s.status === "cooldown") {
      s.status = "pending";
      s.cooldownUntil = null;
      s.lastError = null;
    }
    delete s.expectedTotalPages;
    s.filters = {
      ...(s.filters || {}),
      crawlMode: "brands",
      fullCrawl: true,
      concurrency: CONC,
      delayMs: DELAY,
      detailLevel: "full",
      skipRecentHours: 0,
      countries: [],
    };
  }
  st.shards = brandShards;
  st.currentShardId =
    brandShards.find((s) => s.status === "pending" || s.status === "active")?.id ||
    brandShards[0]?.id ||
    null;
}

await c.query(
  `UPDATE collection_jobs
   SET status='pending', job_config=$1, crawl_state=$2,
       updated_at=now()-interval '1 day', error_message=NULL, completed_at=NULL
   WHERE id=$3`,
  [JSON.stringify(cfg), JSON.stringify(st), JOB_ID],
);
console.log(
  `IM ${JOB_ID} aggressive brands=${cfg.brands.length} conc=${CONC} delayMs=${DELAY} current=${st.currentShardId}`,
);
await c.end();

// Best-effort CDP heal via admin API
try {
  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    }),
  });
  const cookie = (login.headers.getSetCookie?.() ?? [])
    .map((x) => x.split(";")[0])
    .join("; ");
  if (cookie) {
    const heal = await fetch(`${API}/api/admin/import-motor/cdp-heal`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await heal.json().catch(() => ({}));
    console.log("cdp_heal", heal.status, j.poolSize ?? j);
  }
} catch (e) {
  console.log("cdp_heal skipped:", e instanceof Error ? e.message : e);
}
