import type { Request, Response, NextFunction } from "express";

/** Legacy alias hostnames → redirect to PUBLIC_SITE_URL (same path). Comma-separated. */
export function apiPublicHosts(): string[] {
  const raw = process.env.API_PUBLIC_HOST || "api.getcarapi.com";
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function requestHostname(req: Request): string {
  const forwarded = req.headers["x-forwarded-host"];
  const hostHeader =
    (typeof forwarded === "string" ? forwarded.split(",")[0] : Array.isArray(forwarded) ? forwarded[0] : "") ||
    req.headers.host ||
    req.hostname ||
    "";
  return hostHeader.trim().toLowerCase().split(":")[0] ?? "";
}

export function isApiHost(req: Request): boolean {
  return apiPublicHosts().includes(requestHostname(req));
}

export function publicSiteOrigin(): string {
  return (process.env.PUBLIC_SITE_URL || "https://getcarapi.com").replace(/\/$/, "");
}

/** 301 api.getcarapi.com → getcarapi.com (preserve path). Canonical API: getcarapi.com/api/v1/… */
export function redirectApiHostToSite(req: Request, res: Response, next: NextFunction): void {
  if (!isApiHost(req)) {
    next();
    return;
  }
  const target = `${publicSiteOrigin()}${req.originalUrl || "/"}`;
  res.redirect(301, target);
}
