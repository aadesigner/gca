import type { Request, Response } from "express";

/** Hostnames that should serve API only (no marketing site at /). Comma-separated in env. */
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
  const host = requestHostname(req);
  return apiPublicHosts().includes(host);
}

/** Paths still allowed on the API hostname besides /api/*. */
export function isApiHostAllowedPath(pathname: string): boolean {
  return pathname.startsWith("/api") || pathname.startsWith("/docs") || pathname.startsWith("/adminz");
}

export function apiHostRootHandler(req: Request, res: Response): void {
  const site = (process.env.PUBLIC_SITE_URL || "https://getcarapi.com").replace(/\/$/, "");

  if (req.method === "GET" && (req.path === "/" || req.path === "")) {
    res.status(200).json({
      service: "GetCarAPI",
      version: "v1",
      baseUrl: "/api/v1",
      health: "/api/healthz",
      docs: `${site}/api/`,
      openapi: "/api/v1/openapi.json",
      swagger: "/docs",
    });
    return;
  }

  res.status(404).json({
    error: "not_found",
    message: "This host serves the GetCarAPI HTTP API. Use /api/v1/… endpoints.",
    baseUrl: "/api/v1",
    docs: `${site}/api/`,
  });
}
