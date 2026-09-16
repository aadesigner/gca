/** Carstat is production-fleet only — not in the local hard-CF CDP pool (IM, Autoplac, JCT). */
import { isProductionRuntime } from "./import-motor-env";

export function isCarstatOnProduction(): boolean {
  // Default ON in production; set CARSTAT_ON_PRODUCTION=0 to disable.
  return process.env.CARSTAT_ON_PRODUCTION !== "0";
}

/**
 * Pinned Carstat job id. Local always 0 (never pin offline).
 * Set CARSTAT_JOB_ID to pin a specific collection_jobs row on production.
 */
export function effectiveCarstatJobId(): number {
  if (!isProductionRuntime()) return 0;
  if (!isCarstatOnProduction()) return 0;
  const raw = Number(process.env.CARSTAT_JOB_ID ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** Local offline never crawls Carstat — production only. */
export function carstatCrawlAllowed(): boolean {
  if (!isProductionRuntime()) return false;
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
 * Pin Carstat into the production fleet (uses 7th parallel slot) when CDP is configured.
 * Never pins on local (local hard-CF pool is IM + Autoplac + JCT). Set CARSTAT_FLEET=0 to opt out on production.
 */
export function carstatFleetPinEnabled(): boolean {
  if (!isProductionRuntime()) return false;
  if (!carstatCrawlAllowed() || !carstatCdpReady()) return false;
  if (process.env.CARSTAT_FLEET === "0") return false;
  return true;
}
