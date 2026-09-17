/**
 * Carstat uses Chrome CDP (Cloudflare). Production fleet by default;
 * local hard-CF pool can take the JCT slot when CDP is up (CARSTAT_LOCAL≠0).
 */
import { isProductionRuntime } from "./import-motor-env";

export function isCarstatOnProduction(): boolean {
  // Default ON in production; set CARSTAT_ON_PRODUCTION=0 to disable.
  return process.env.CARSTAT_ON_PRODUCTION !== "0";
}

/** Local offline Carstat — default ON when CDP is configured; set CARSTAT_LOCAL=0 to keep it off. */
export function isCarstatOnLocal(): boolean {
  return process.env.CARSTAT_LOCAL !== "0";
}

/**
 * Pinned Carstat job id.
 * Production: CARSTAT_JOB_ID. Local: CARSTAT_JOB_ID or 0 (resolve from DB).
 */
export function effectiveCarstatJobId(): number {
  if (isProductionRuntime() && !isCarstatOnProduction()) return 0;
  if (!isProductionRuntime() && !isCarstatOnLocal()) return 0;
  const raw = Number(process.env.CARSTAT_JOB_ID ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** Allow Carstat crawl when CDP is ready (prod fleet and/or local offline pool). */
export function carstatCrawlAllowed(): boolean {
  if (!carstatCdpReady()) return false;
  if (isProductionRuntime()) return isCarstatOnProduction();
  return isCarstatOnLocal();
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
 * Pin Carstat into the fleet when CDP is configured.
 * Production: 7th parallel slot. Local: replaces JCT in the hard-CF CDP pool.
 * Set CARSTAT_FLEET=0 to opt out.
 */
export function carstatFleetPinEnabled(): boolean {
  if (!carstatCrawlAllowed() || !carstatCdpReady()) return false;
  if (process.env.CARSTAT_FLEET === "0") return false;
  return true;
}
