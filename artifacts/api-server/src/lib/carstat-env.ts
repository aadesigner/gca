/** Carstat requires local Chrome CDP — off on Railway/production unless explicitly enabled. */
import { isProductionRuntime } from "./import-motor-env";

export function isCarstatOnProduction(): boolean {
  // Default ON so Carstat can use the 7th fleet slot; set CARSTAT_ON_PRODUCTION=0 to disable.
  return process.env.CARSTAT_ON_PRODUCTION !== "0";
}

/**
 * Pinned Carstat job id — 0 on production when Carstat is disabled.
 * Set CARSTAT_JOB_ID to pin a specific collection_jobs row.
 */
export function effectiveCarstatJobId(): number {
  const raw = Number(process.env.CARSTAT_JOB_ID ?? 0);
  if (isProductionRuntime() && !isCarstatOnProduction()) return 0;
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function carstatCrawlAllowed(): boolean {
  if (!isProductionRuntime()) return true;
  return isCarstatOnProduction();
}

/** CDP endpoint required for Carstat (Cloudflare). Shares Import Motor Chrome by default. */
export function carstatCdpReady(): boolean {
  return Boolean(
    process.env.IMPORT_MOTOR_CDP_URL?.trim() ||
      process.env.CARSTAT_CDP_URL?.trim() ||
      process.env.AUTOPLAC_CDP_URL?.trim(),
  );
}

/**
 * Pin Carstat into the fleet when crawl is allowed and CDP is configured.
 * Set CARSTAT_FLEET=0 to opt out; CARSTAT_JOB_ID pins a specific job.
 * Uses the 7th parallel slot (COLLECTION_JOBS_PARALLEL default 7) alongside other crawlers.
 */
export function carstatFleetPinEnabled(): boolean {
  if (!carstatCrawlAllowed() || !carstatCdpReady()) return false;
  if (process.env.CARSTAT_FLEET === "0") return false;
  return true;
}
