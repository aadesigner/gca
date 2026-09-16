/** Carstat requires local Chrome CDP — off on Railway/production unless explicitly enabled. */
import { isProductionRuntime } from "./import-motor-env";

export function isCarstatOnProduction(): boolean {
  return process.env.CARSTAT_ON_PRODUCTION === "1";
}

/**
 * Pinned Carstat job id — 0 on production when CARSTAT_ON_PRODUCTION is not set.
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
 * Auto-pin Carstat into the fleet only with an explicit opt-in:
 *   CARSTAT_JOB_ID=<id>  and/or  CARSTAT_FLEET=1
 * plus CDP ready, and CARSTAT_ON_PRODUCTION=1 on Railway.
 */
export function carstatFleetPinEnabled(): boolean {
  if (!carstatCrawlAllowed() || !carstatCdpReady()) return false;
  if (effectiveCarstatJobId() > 0) return true;
  return process.env.CARSTAT_FLEET === "1";
}
