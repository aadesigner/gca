/**
 * Production fleet crawl cadence: ~4–6h per provider, staggered so jobs
 * do not all start at once (Railway-friendly; stays under parallel caps).
 */
import { mergeCrawlDefaults } from "./crawl-profiles";

/** Never auto-schedule these (internal mirrors, Cloudflare-gated, no public VIN, etc.). */
export const FLEET_SKIP_PROVIDERS = new Set([
  "getcarapi",
  "kmcheck",
  "kmcheck_manual",
  "carstat",
  "bidcars",
  "carsandbids",
  "ams",
  // Public VIN masked / members-only / crawl produced 0 VIN listings.
  "che168",
  "autohome",
  "ssancar",
  "heydealer",
  "bobaedream",
  "bobaedreamcyber",
  "autobell",
  "kcar",
  "mango",
  "auctionwini",
  "automobileit",
  "autoscout24_es",
  "autoscout24_be",
  "autotradernl",
  "subito",
  "standvirtual",
  "mobilebg",
  // IAA anonymous search only yields ~100 newest lots; Copart BidScan covers salvage.
  "iaa",
  // Requires local Chrome CDP — never auto-fleet on Railway (see import-motor-env).
  "import_motor",
]);

/**
 * Prefer listing_refresh names for docs / ops — fleet scheduling always starts
 * full_collection; listing_refresh is created only after each full finishes
 * (LISTING_REFRESH_FOLLOWUP in the worker).
 */
export const FLEET_LISTING_REFRESH_PROVIDERS = new Set([
  "encar",
  "autowini",
  "kbchachacha",
  "autoscout24",
  "autotraderca",
  "dubicars",
  "otomoto",
  "cars24ae",
  "aaaauto",
  "autoplac",
  "sauto",
  "willhaben",
  "carpages",
  "ontariocars",
  "lotte_autoglobal",
  "kolon_auto",
  "charancha",
  "autohub",
  "carpoolkr",
  "mobilede",
  "bidexport",
  "thebidrive",
  "japanesecartrade",
  "salvagebid",
  "bringatrailer",
  "copart",
  "auctionauto",
  "seobuk",
  "koreaauto_auction",
  "koreausedcars",
  "lotteautoauction",
  "autoinside",
  "autobellglobal",
  "rbautotrade",
  "senaauto",
]);

/** 4–6h band — staggered so providers do not all wake at once. */
const REPEAT_VARIANTS_HOURS = [4, 5, 6] as const;

/** Always schedule these on production fleet runs (even before first items_processed). */
export const FLEET_PRIORITY_PROVIDERS = new Set([
  "autowini",
  "kbchachacha",
  "carpoolkr",
  "charancha",
  "autohub",
  "lotteautoauction",
  "autoinside",
  "autobellglobal",
  "rbautotrade",
  "senaauto",
  "aaaauto",
  "autoplac",
  "autoscout24",
  "autotraderca",
  "sauto",
  "mobilede",
  "willhaben",
  "otomoto",
  "dubicars",
  "cars24ae",
  "carpages",
  "ontariocars",
  "bidexport",
  "thebidrive",
  "japanesecartrade",
  "salvagebid",
  "bringatrailer",
  "copart",
  "lotte_autoglobal",
  "kolon_auto",
]);

function nameHash(internalName: string, salt = 0): number {
  let h = salt;
  for (let i = 0; i < internalName.length; i++) h = (h * 31 + internalName.charCodeAt(i)) >>> 0;
  return h;
}

/** Stable 4 / 5 / 6h cadence per provider. */
export function fleetRepeatHours(internalName: string): number {
  const overrides: Record<string, number> = {
    encar: 5,
    import_motor: 5,
    copart: 4,
    thebidrive: 4,
    japanesecartrade: 5,
    bidexport: 5,
    ontariocars: 5,
    autoplac: 5,
    autowini: 5,
    mobilede: 5,
  };
  if (overrides[internalName] != null) return overrides[internalName]!;
  return REPEAT_VARIANTS_HOURS[nameHash(internalName) % REPEAT_VARIANTS_HOURS.length]!;
}

/** Spread first start within the repeat window (minutes). */
export function fleetStaggerMinutes(internalName: string, jobKey = ""): number {
  const repeatMins = fleetRepeatHours(internalName) * 60;
  const h = nameHash(`${internalName}:${jobKey}`, 17);
  return h % Math.max(30, repeatMins - 15);
}

export function fleetJobType(internalName: string, explicit?: string): string {
  if (explicit) return explicit;
  if (internalName === "import_motor") {
    return process.env.IMPORT_MOTOR_FULL_CRAWL === "1" ? "full_collection" : "incremental";
  }
  // Fleet never invents listing_refresh — that starts only after full_collection
  // completes (LISTING_REFRESH_FOLLOWUP). Keeps the full-coverage campaign intact.
  return "full_collection";
}

/**
 * Brand-new priority marketplaces start with unbounded full_collection;
 * worker hands off to listing_refresh (~4–6h) via LISTING_REFRESH_FOLLOWUP.
 */
export function fleetStartJobType(internalName: string, _hasProcessedItems: boolean): string {
  return fleetJobType(internalName);
}

export function fleetJobConfig(
  internalName: string,
  jobType: string,
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  const repeatHours = fleetRepeatHours(internalName);
  const merged = mergeCrawlDefaults(internalName, patch, jobType);
  const cfg: Record<string, unknown> = {
    ...merged,
    repeatHours,
    staggerMinutes: fleetStaggerMinutes(internalName, jobType),
    maxPages: 0,
    maxListings: 0,
  };
  if (
    jobType === "full_collection" &&
    (internalName === "encar" ||
      internalName === "autowini" ||
      internalName === "thebidrive" ||
      internalName === "japanesecartrade")
  ) {
    cfg.skipRecentHours = 0;
    cfg.detailLevel = "full";
  }
  if (jobType === "listing_refresh") {
    cfg.detailLevel = "standard";
    cfg.skipRecentHours = Math.max(0, repeatHours - 2);
  }
  if (internalName === "import_motor" && process.env.IMPORT_MOTOR_FULL_CRAWL === "1") {
    cfg.fullCrawl = true;
    cfg.skipRecentHours = 0;
    cfg.maxPages = 0;
    cfg.maxListings = 0;
    delete cfg.origins;
  } else if (internalName === "import_motor" && jobType === "incremental") {
    cfg.origins = patch.origins ?? ["korean"];
    cfg.maxPages = patch.maxPages ?? 8;
    cfg.maxListings = patch.maxListings ?? 400;
  }
  return cfg;
}

export function scheduleNextRunAt(repeatHours: number, fromMs = Date.now()): string {
  return new Date(fromMs + repeatHours * 60 * 60 * 1000).toISOString();
}

export function initialStaggeredRunAt(internalName: string, jobKey = ""): string {
  const staggerMs = fleetStaggerMinutes(internalName, jobKey) * 60 * 1000;
  return new Date(Date.now() + staggerMs).toISOString();
}

/** Immediate start — worker treats missing/past nextRunAt as due now. */
export function runAtNow(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

export function resolveScheduledRepeatHours(
  jobType: string,
  filterParams: Record<string, unknown>,
  internalName: string,
): number {
  if (filterParams.repeatHours === 0 || filterParams.repeatHours === "0") return 0;
  const explicit = Number(filterParams.repeatHours ?? 0);
  if (explicit > 0) return explicit;
  if (jobType === "listing_refresh" || jobType === "incremental" || jobType === "full_collection") {
    return fleetRepeatHours(internalName);
  }
  return 0;
}

export function parseJobConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function isFutureRun(cfg: Record<string, unknown>): boolean {
  const at = cfg.nextRunAt;
  if (typeof at !== "string" || !at.trim()) return false;
  const ms = Date.parse(at);
  return Number.isFinite(ms) && ms > Date.now();
}
