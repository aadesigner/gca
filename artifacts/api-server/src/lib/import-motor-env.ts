/** Import Motor requires local Chrome CDP — off on Railway/production unless explicitly enabled. */
export function isImportMotorOnProduction(): boolean {
  return process.env.IMPORT_MOTOR_ON_PRODUCTION === "1";
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);
}

/** Pinned IM job id — 0 on production when IMPORT_MOTOR_ON_PRODUCTION is not set. */
export function effectiveImJobId(): number {
  const raw = Number(process.env.IM_JOB_ID ?? 360);
  if (isProductionRuntime() && !isImportMotorOnProduction()) return 0;
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function importMotorCrawlAllowed(): boolean {
  if (!isProductionRuntime()) return true;
  return isImportMotorOnProduction();
}
