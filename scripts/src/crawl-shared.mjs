/** Shared crawl boost / heal helpers for ops scripts. */

export const LISTING_REFRESH_PROVIDERS = new Set([
  "encar",
  "ams",
  "autowini",
  "autoscout24",
  "autotraderca",
  "dubicars",
  "otomoto",
  "kcar",
  "cars24ae",
  "willhaben",
  "carpages",
  "autobell",
  "lotte_autoglobal",
  "kolon_auto",
]);

/** Never auto-start these (internal / Cloudflare-gated). */
export const SKIP_PROVIDERS = new Set([
  "getcarapi",
  "kmcheck",
  "kmcheck_manual",
  "carstat",
  "bidcars",
  "carsandbids",
]);

/** Per-provider defaults (subset of crawl-profiles.ts). */
export const PROFILE_DEFAULTS = {
  encar: { delayMs: 500, concurrency: 3, retryCount: 3 },
  autowini: { delayMs: 400, concurrency: 3, retryCount: 3 },
  kbchachacha: { delayMs: 800, concurrency: 2, retryCount: 3 },
  koreaauto_auction: { delayMs: 600, concurrency: 3, retryCount: 3 },
  carpoolkr: { delayMs: 800, concurrency: 2, retryCount: 3 },
  lotte_autoglobal: { delayMs: 500, concurrency: 3, retryCount: 3 },
  kolon_auto: { delayMs: 400, concurrency: 4, retryCount: 3 },
  auctionauto: { delayMs: 400, concurrency: 6, retryCount: 3 },
  salvagebid: { delayMs: 1200, concurrency: 2, retryCount: 3 },
  bringatrailer: { delayMs: 1500, concurrency: 2, retryCount: 3 },
  autotraderca: { delayMs: 1200, concurrency: 2, retryCount: 3 },
  dubicars: { delayMs: 1200, concurrency: 2, retryCount: 3 },
  cars24ae: { delayMs: 1200, concurrency: 2, retryCount: 3 },
  carpages: { delayMs: 1200, concurrency: 2, retryCount: 3 },
  import_motor: { delayMs: 70, concurrency: 16, retryCount: 5 },
  copart: { delayMs: 200, concurrency: 8, retryCount: 3 },
};

export function mergeConfig(existing, patch) {
  const base = existing ? JSON.parse(existing) : {};
  return JSON.stringify({ ...base, ...patch });
}

export function restartCrawlState(raw, wasStatus) {
  if (wasStatus === "completed" || wasStatus === "cancelled") {
    return { json: null, fixed: 1 };
  }
  return healCrawlState(raw);
}

export function healCrawlState(raw) {
  if (!raw) return { json: raw, fixed: 0 };
  const st = JSON.parse(raw);
  const now = Date.now();
  let fixed = 0;
  for (const shard of st.shards ?? []) {
    if (shard.status === "cooldown" && shard.cooldownUntil && Date.parse(shard.cooldownUntil) <= now) {
      shard.status = "pending";
      shard.cooldownUntil = null;
      fixed++;
    }
    if (shard.lastError?.includes("buyer-locations returned 0 countries")) {
      shard.status = "pending";
      shard.cooldownUntil = null;
      shard.lastError = null;
      shard.discoverFailures = 0;
      fixed++;
    }
    if ((shard.discoverFailures ?? 0) >= 8 && (shard.listingsFetched ?? 0) === 0) {
      shard.discoverFailures = 0;
      shard.status = "pending";
      shard.cooldownUntil = null;
      shard.lastError = null;
      fixed++;
    }
  }
  if (st.currentShardId) {
    const cur = st.shards?.find((s) => s.id === st.currentShardId);
    if (cur && cur.status === "cooldown") {
      st.currentShardId = null;
      fixed++;
    }
  }
  return { json: JSON.stringify(st), fixed };
}

/** Aggressive but within worker caps (concurrency max 16). */
export function fleetRepeatHoursJs(internalName) {
  const overrides = { encar: 6, import_motor: 6, copart: 5, iaa: 5 };
  if (overrides[internalName] != null) return overrides[internalName];
  const variants = [5, 6, 7];
  let h = 0;
  for (let i = 0; i < internalName.length; i++) h = (h * 31 + internalName.charCodeAt(i)) >>> 0;
  return variants[h % 3];
}

export function fleetStaggerMinutesJs(internalName, jobKey = "") {
  const repeatMins = fleetRepeatHoursJs(internalName) * 60;
  const key = `${internalName}:${jobKey}`;
  let h = 17;
  for (let i = 0; i < key.length; i++) h = (h * 37 + key.charCodeAt(i)) >>> 0;
  return h % Math.max(30, repeatMins - 15);
}

/** Aggressive but within worker caps (concurrency max 16). */
export function boostForProvider(internalName, jobType) {
  const profile = PROFILE_DEFAULTS[internalName] ?? { delayMs: 800, concurrency: 2, retryCount: 3 };
  let concurrency = profile.concurrency;
  if (internalName === "import_motor") concurrency = 16;
  else if (internalName === "copart") concurrency = 8;
  else if (internalName === "encar" || internalName === "autowini") concurrency = 16;
  else concurrency = Math.min(16, Math.max(profile.concurrency, 4));

  let delayMs = profile.delayMs;
  if (internalName === "import_motor") delayMs = 70;
  else if (internalName === "copart") delayMs = 100;
  else if (internalName === "encar" || internalName === "autowini") delayMs = 100;
  else delayMs = Math.max(150, Math.floor(profile.delayMs * 0.4));

  const repeatHours = fleetRepeatHoursJs(internalName);
  const cfg = {
    concurrency,
    delayMs,
    skipRecentHours:
      jobType === "listing_refresh"
        ? Math.max(0, repeatHours - 2)
        : internalName === "encar" || internalName === "autowini" || internalName === "import_motor"
          ? 0
          : 12,
    maxPages: 0,
    maxListings: 0,
    retryCount: profile.retryCount,
    detailLevel: jobType === "listing_refresh" ? "standard" : "full",
    repeatHours,
    staggerMinutes: fleetStaggerMinutesJs(internalName, jobType),
  };
  if (internalName === "import_motor") {
    cfg.fullCrawl = true;
  }
  return cfg;
}

export function preferredJobType(internalName) {
  return LISTING_REFRESH_PROVIDERS.has(internalName) ? "listing_refresh" : "full_collection";
}
